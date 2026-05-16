from opc_client_manager import OPCClientManager
import asyncio

async def read_node(node_id):
    client = await OPCClientManager.get_client()
    node = client.get_node(node_id)
    value = await node.get_value()
    return value

# Optional: helper for multiple nodes
async def read_nodes(node_ids: list):
    client = await OPCClientManager.get_client()
    nodes = [client.get_node(nid) for nid in node_ids]
    values = await asyncio.gather(*[node.get_value() for node in nodes])
    return dict(zip(node_ids, values))


if __name__ == "__main__":
    async def test():
        value = await read_node('ns=3;s="DB OPC Data"."Counter"')
        print("Value:", value)
    
    asyncio.run(test())