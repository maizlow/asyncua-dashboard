import sqlite3
from pathlib import Path

DB_PATH = "data.db"

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

print("=== Tables in database ===")
cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = [row[0] for row in cur.fetchall()]
print(tables)
print()

for table in tables:
    try:
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        count = cur.fetchone()[0]
        print(f"=== {table} ({count} rows) ===")

        if table == "shift_log":
            cur.execute("SELECT * FROM shift_log ORDER BY rowid DESC LIMIT 35")
        elif table == "data_points":
            cur.execute("SELECT * FROM data_points ORDER BY rowid DESC LIMIT 15")
        else:
            cur.execute(f"SELECT * FROM {table} LIMIT 5")

        for row in cur.fetchall():
            print(row)
        print()
    except Exception as e:
        print(f"Error reading {table}: {e}")

conn.close()