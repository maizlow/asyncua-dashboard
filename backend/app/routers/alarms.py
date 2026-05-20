from fastapi import APIRouter, HTTPException
from backend.opc.state_store import alarm_store

router = APIRouter(prefix="/api", tags=["Alarms"])


@router.get("/alarms")
async def get_active_alarms():
    """Returns all currently active alarms."""
    alarms = alarm_store.get_all()
    return {
        "count": len(alarms),
        "alarms": list(alarms.values())
    }


@router.get("/alarms/id/{id}")
async def get_alarm_by_id(id: str):
    alarms = alarm_store.get_all()

    try:
        alarm_id = int(id)
    except ValueError:
        alarm_id = id

    if alarm_id not in alarms:
        raise HTTPException(status_code=404, detail="Alarm not found")

    return alarms[alarm_id]

@router.get("/alarms/class/{classNr}")
async def get_alarm_by_class(classNr: str):
    """Get alarms filtered by displayClass (case + type safe)."""
    alarms = alarm_store.get_all()

    # Try to convert class number to int (most common case)
    try:
        class_number = int(classNr)
    except ValueError:
        class_number = classNr

    # Filter alarms where displayClass matches
    class_alarms = [
        alarm for alarm in alarms.values()
        if getattr(alarm, "displayClass", None) == class_number
    ]

    if not class_alarms:
        raise HTTPException(
            status_code=404, 
            detail=f"No alarms found for class '{classNr}'"
        )

    return class_alarms

@router.get("/alarms/count")
async def get_alarm_count():
    """Quick endpoint to get only the number of active alarms."""
    return {"active_alarms": len(alarm_store.get_all())}