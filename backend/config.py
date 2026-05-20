DEFAULT_NODES = {
"ConditionType": "ns=0;i=2782",         # Base ConditionType Node (for method calls)
"ProgramAlarms": "ns=3;i=1815",         # Example: Siemens Program Alarm Server Object
}

# Variables to subscribe to (add node ids or browse paths as needed)
SCREEN_NODES = {
    "ActiveScreenNr": 'ns=3;s="DB Production TV"."screenHandler"."activeScreenNr"', 
    "RequestedScreenNr": 'ns=3;s="DB Production TV"."screenHandler"."requestScreenNr"',
    # Add more nodes or browse paths here if you want to subscribe to additional events or data changes
}

DASHBOARD_DATA_NODES = [
    {
        "nodeid": 'ns=3;s="DB Production TV"."dashboardData"."target"',
        "alias": "TargetCount",
        "historical": False,
    },
    {
        "nodeid": 'ns=3;s="DB Production TV"."dashboardData"."actual"',
        "alias": "ProductionCount",
        "historical": False,
    },
    {
        "nodeid": 'ns=3;s="DB Production TV"."dashboardData"."deltaActual"',
        "alias": "ProductionDelta",
        "historical": True,
    },
    {
        "nodeid": 'ns=3;s="DB Production TV"."dashboardData"."deltaActualProd"',
        "alias": "ProductionDeltaTiles",
        "historical": True,
    },
    {
        "nodeid": 'ns=3;s="DB Production TV"."dashboardData"."prodState"',
        "alias": "ProductionState",
        "historical": False,
    },
    {
        "nodeid": 'ns=3;s="DB Production TV"."dashboardData"."oee"',
        "alias": "OEE",
        "historical": True,
    },
    {
        "nodeid": 'ns=3;s="DB Production TV"."dashboardData"."oeeDelta"',
        "alias": "OEEDelta",
        "historical": True,
    }
    # Add more nodes or browse paths here for any additional data you want to display on the dashboard
]
