from dataclasses import dataclass
from datetime import datetime

@dataclass
class AlarmDetails:    
    ID: str
    message: str
    timestamp: datetime
    displayClass: int
    