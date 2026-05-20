from asyncua import ua
import asyncio
import logging
import re
import backend.config as config
from backend.settings import settings

from backend.opc.models import AlarmDetails
from backend.opc.state_store import alarm_store

logging.basicConfig(level=settings.log_level)

class AlarmHandler:
    def get_associated_value(self, event, index):
        """Helper to safely fetch the unwrapped value for a given SD index."""
        possible_names = [f"AssociatedValue_{index:02d}", f"3_AssociatedValue_{index:02d}"]
        for attr_name in possible_names:
            if hasattr(event, attr_name):
                val = getattr(event, attr_name)
                if val is not None:
                    return getattr(val, 'Value', val)
        return None

    def parse_and_replace_placeholders(self, msg, event):
        """Finds Siemens placeholders (e.g. @2%u@) and replaces them with live data."""
        def replace_match(match):
            index = int(match.group(1))      
            fmt_spec = match.group(2)        
            
            val = self.get_associated_value(event, index)
            if val is None:
                return match.group(0)        
            
            python_fmt = fmt_spec.lower().replace('u', 'd')
            
            try:
                return f"%{python_fmt}" % val
            except Exception:
                return str(val)              

        placeholder_pattern = r'@(\d+)%([0-9]*[a-zA-Z])@'
        return re.sub(placeholder_pattern, replace_match, msg)

    def event_notification(self, event):
        """Callback triggered whenever the S7-1500 fires a Program Alarm."""
        msg = getattr(event, 'Message', 'N/A')
        if hasattr(msg, 'Text'):
            msg = msg.Text
        
        # Parse and merge the associated values into placeholders
        final_alarm_text = self.parse_and_replace_placeholders(msg, event)
        
        timestamp = getattr(event, 'Time', 'N/A')
        if hasattr(timestamp, 'strftime'):
            timestamp = timestamp.strftime('%Y-%m-%d %H:%M:%S')
       
        id = getattr(event, 'ID', None)
        print(f"Raw ID value: {id}")
               
        displayclass = getattr(event, 'DisplayClass', None)

        active_state = getattr(event, 'ActiveState/Id', None)

        if active_state is True:
            new_alarm = AlarmDetails(
                ID=id,
                message=final_alarm_text,
                timestamp=timestamp,
                displayClass=displayclass
            )
            alarm_store.add_alarm(id, new_alarm)
          
        elif active_state is False:
            alarm_store.remove_alarm(id)
            

    def status_change_notification(self, status):
        pass  


async def subscribe_program_alarms(client=None, sync_lock=None):
    
        try:
            handler = AlarmHandler()
            subscription = await client.create_subscription(1000, handler)
            
            event_filter = ua.EventFilter()
            
            def make_select_clause(type_int_id, path_list):
                clause = ua.SimpleAttributeOperand()
                clause.TypeDefinitionId = ua.NodeId(type_int_id, 0, ua.NodeIdType.Numeric)
                clause.BrowsePath = [ua.QualifiedName(p, 0) if isinstance(p, str) else p for p in path_list]
                clause.AttributeId = ua.AttributeIds.Value
                return clause

            # Standard Fields
            event_filter.SelectClauses.append(make_select_clause(ua.ObjectIds.BaseEventType, ['Message']))
            event_filter.SelectClauses.append(make_select_clause(ua.ObjectIds.BaseEventType, ['Time']))
            event_filter.SelectClauses.append(make_select_clause(ua.ObjectIds.BaseEventType, ['Severity']))
            event_filter.SelectClauses.append(make_select_clause(ua.ObjectIds.BaseEventType, ['EventType']))

            # State Fields (Crucial to fetch the Active and Acknowledged states)
            event_filter.SelectClauses.append(make_select_clause(ua.ObjectIds.AlarmConditionType, ['ActiveState', 'Id']))
            event_filter.SelectClauses.append(make_select_clause(ua.ObjectIds.AlarmConditionType, ['AckedState', 'Id']))
            
            # Siemens Associated Values (SD_1 to SD_10)
            siemens_ns_index = 3 
            for i in range(1, 11):
                field_name = f"AssociatedValue_{i:02d}"
                operand = ua.SimpleAttributeOperand()
                operand.TypeDefinitionId = ua.NodeId(ua.ObjectIds.AlarmConditionType, 0, ua.NodeIdType.Numeric)
                operand.BrowsePath = [ua.QualifiedName(field_name, siemens_ns_index)]
                operand.AttributeId = ua.AttributeIds.Value
                event_filter.SelectClauses.append(operand)
                
            # Siemens DisplayClass (to determine if it's a Program Alarm or not)    
            field_name = f"DisplayClass"
            operand = ua.SimpleAttributeOperand()
            operand.TypeDefinitionId = ua.NodeId(ua.ObjectIds.AlarmConditionType, 0, ua.NodeIdType.Numeric)
            operand.BrowsePath = [ua.QualifiedName(field_name, siemens_ns_index)]
            operand.AttributeId = ua.AttributeIds.Value
            event_filter.SelectClauses.append(operand)  

            # Siemens ID (to determine if it's a Program Alarm or not)    
            field_name = f"ID"
            operand = ua.SimpleAttributeOperand()
            operand.TypeDefinitionId = ua.NodeId(ua.ObjectIds.AlarmConditionType, 0, ua.NodeIdType.Numeric)
            operand.BrowsePath = [ua.QualifiedName(field_name, siemens_ns_index)]
            operand.AttributeId = ua.AttributeIds.Value
            event_filter.SelectClauses.append(operand) 
              
            server_node = client.get_node(config.DEFAULT_NODES["ProgramAlarms"])
            await subscription._subscribe(server_node, ua.AttributeIds.EventNotifier, event_filter)
            print(f"✅ Subscribed to Program Alarms with States. Monitoring active...")
            
            # Base ConditionType Node ID is fixed across ALL OPC UA servers worldwide (ns=0;i=2782)
            condition_type_node = client.get_node(config.DEFAULT_NODES["ConditionType"])
            
            # Execute the method on the server, passing your specific Subscription ID
            await condition_type_node.call_method(
                "0:ConditionRefresh", 
                ua.Variant(subscription.subscription_id, ua.VariantType.UInt32)
            )

            # Give the PLC a 3-second buffer to flush all active alarms over the network
            await asyncio.sleep(3)
            
            # GREEN LIGHT: Unlock the tag engine so it can safely subscribe!
            if sync_lock:
                sync_lock.set()


            while True:
                await asyncio.sleep(1)
                
                # The official asyncua method to poll the server connection health.
                # If the server is offline or drops, this will automatically raise an exception.
                await client.check_connection()
                
        except (Exception) as e:
            print(f"\n❌ Error in alarm event handling: {e}.")
            raise  # Re-raise to let opc_client.py handle reconnection logic

if __name__ == "__main__":
    try:
        asyncio.run(subscribe_program_alarms())
    except KeyboardInterrupt:
        print("\nApplication closed.")