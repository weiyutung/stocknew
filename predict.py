import csv
import mysql.connector
from datetime import datetime, timedelta

# ===============================
# 參數設定（你只需改這裡）
# ===============================
CSV_PATH = "AAPL_test_preds.csv"
SYMBOL = "AAPL"

# ➜ 只匯入這一天的那 30 筆預測
TARGET_DATE = "2024-03-21"

MYSQL_CONFIG = dict(
    host="localhost",
    port=3306,
    user="root",
    password="1135j0 wu6b05",
    database="stockboard",
)

TABLE_NAME = "history_prediction"
# ===============================


def convert_label(label):
    if label == "漲":
        return "up"
    elif label == "跌":
        return "down"
    return "flat"


def create_table_if_not_exists(conn):
    sql = f"""
    CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
        symbol    VARCHAR(10) NOT NULL,
        pred_date DATE        NOT NULL,
        day_index TINYINT UNSIGNED NOT NULL,
        dir       ENUM('up','down','flat') NOT NULL,
        PRIMARY KEY (symbol, pred_date, day_index)
    );
    """
    cur = conn.cursor()
    cur.execute(sql)
    conn.commit()
    cur.close()


def main():

    # 讀 CSV + 自動移除 BOM
    with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)

        # ⭐ 修復欄位名稱汙染（例如 '\ufeffdate' → 'date'）
        reader.fieldnames = [fn.lstrip("\ufeff").strip() for fn in reader.fieldnames]

        rows = list(reader)

    if not rows:
        raise ValueError("CSV 是空的")

    # ⭐ 找到你指定的那一列
    target_row = None
    for row in rows:
        if row.get("date") == TARGET_DATE:
            target_row = row
            break

    if not target_row:
        raise KeyError(f"CSV 找不到 date = {TARGET_DATE}，欄位有：{list(rows[0].keys())}")

    conn = mysql.connector.connect(**MYSQL_CONFIG)
    create_table_if_not_exists(conn)
    cur = conn.cursor()

    base_date = datetime.strptime(TARGET_DATE, "%Y-%m-%d").date()

    # 處理 pred_labels
    raw = target_row["pred_labels"]

    pred_labels = (
        raw.strip("[] ")
           .replace("'", "")
           .split(",")
    )
    pred_labels = [p.strip() for p in pred_labels]

    if len(pred_labels) != 30:
        raise ValueError(f"pred_labels 不是 30 筆：{pred_labels}")

    # ⭐ 只寫入這一列的 30 筆
    for i, label in enumerate(pred_labels, start=1):
        pred_day = base_date + timedelta(days=i)

        sql = f"""
            REPLACE INTO {TABLE_NAME} (symbol, pred_date, day_index, dir)
            VALUES (%s, %s, %s, %s)
        """
        cur.execute(sql, (
            SYMBOL,
            pred_day,
            i,
            convert_label(label)
        ))

    conn.commit()
    cur.close()
    conn.close()

    print(f"✅ 已匯入 {TARGET_DATE} 的 30 筆預測！")


if __name__ == "__main__":
    main()
