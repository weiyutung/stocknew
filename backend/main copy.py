# C:\StockWebPage\backend\main.py
from pathlib import Path
from datetime import date
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
import os
import mysql.connector
from mysql.connector import pooling

# 讀取同層 .env（避免工作目錄不同載不到）
load_dotenv(Path(__file__).with_name(".env"))

DB_CONFIG = {
    "host": os.getenv("MYSQL_HOST", "127.0.0.1"),
    "user": os.getenv("MYSQL_USER", "root"),
    # 不要在程式碼硬編密碼，改放到 .env
    "password": os.getenv("MYSQL_PASSWORD", ""),
    "database": os.getenv("MYSQL_DB", "stockboard"),
    "port": int(os.getenv("MYSQL_PORT", "3306")),
    "charset": "utf8mb4",
    "autocommit": True,
}

# 建連線池
pool = pooling.MySQLConnectionPool(pool_name="stock_pool", pool_size=5, **DB_CONFIG)

app = FastAPI(title="Stock API", version="1.0.0")

# 若用 Caddy 反代到同源，可關掉；保留也無妨
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# =============================
# API
# =============================

@app.get("/api/health")
def health():
    try:
        cn = pool.get_connection()
        with cn.cursor() as cur:
            cur.execute("SELECT 1")
            _ = cur.fetchone()
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DB not ok: {e}")
    finally:
        try:
            cn.close()
        except:
            pass

@app.get("/api/stocks")
def get_stocks(
    symbol: str = Query(..., min_length=1),
    count:  int = Query(66, ge=1, le=2000),
):
    """
    取得指定股票最近 count 筆（由舊到新）。
    注意：選取欄位請對應你的資料表實際欄位。
    """
    sql = """
        SELECT
            date, symbol, open, high, low, close, volume,
            Sma_5, Sma_10, Sma_20, Sma_60, Sma_120, Sma_240,
            DIF, DEA, K, D, J ,Bias
        FROM stocks
        WHERE symbol = %s
        ORDER BY date DESC
        LIMIT %s
    """
    try:
        cn = pool.get_connection()
        cur = cn.cursor(dictionary=True)
        cur.execute(sql, (symbol, count))
        rows = cur.fetchall()
        rows.reverse()  # 由舊到新
        return rows
    except mysql.connector.Error as e:
        raise HTTPException(status_code=500, detail=f"MySQL error: {e}")
    finally:
        try:
            cur.close(); cn.close()
        except:
            pass

@app.get("/api/stocks/range")
def get_stocks_range(
    symbol: str = Query(..., min_length=1),
    start: str = Query(..., description="YYYY-MM-DD"),
    end:   str = Query(..., description="YYYY-MM-DD"),
):
    """
    依日期區間取資料（由舊到新）。
    """
    sql = """
        SELECT
            date, symbol, open, high, low, close, volume,
            Sma_5, Sma_10, Sma_20, Sma_60, Sma_120, Sma_240,
            DIF, DEA, K, D, J,Bias
        FROM stocks
        WHERE symbol = %s AND date BETWEEN %s AND %s
        ORDER BY date ASC
    """
    try:
        # 簡單檢查日期格式
        _ = date.fromisoformat(start)
        _ = date.fromisoformat(end)

        cn = pool.get_connection()
        cur = cn.cursor(dictionary=True)
        cur.execute(sql, (symbol, start, end))
        rows = cur.fetchall()
        return rows
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    except mysql.connector.Error as e:
        raise HTTPException(status_code=500, detail=f"MySQL error: {e}")
    finally:
        try:
            cur.close(); cn.close()
        except:
            pass

@app.get("/api/suggest")
def suggest(
    q: str = Query(..., min_length=1),
    limit: int = Query(10, ge=1, le=50),
):
    """
    股票代號/名稱模糊搜尋。
    需要你有一張 symbols（或你自己的對照表），若沒有就回傳空陣列不報錯。
    建議欄位：symbol, name_zh, name_en, short_name_zh, short_name_en
    """
    sql = """
        SELECT symbol, name_zh, name_en, short_name_zh, short_name_en
        FROM symbols
        WHERE symbol LIKE %s
           OR name_zh LIKE %s
           OR name_en LIKE %s
           OR short_name_zh LIKE %s
           OR short_name_en LIKE %s
        ORDER BY symbol
        LIMIT %s
    """
    like = f"%{q}%"
    try:
        cn = pool.get_connection()
        cur = cn.cursor(dictionary=True)
        cur.execute(sql, (like, like, like, like, like, limit))
        return cur.fetchall()
    except mysql.connector.Error:
        # 沒有這張表就回空陣列，前端會顯示「無符合股票」
        return []
    finally:
        try:
            cur.close(); cn.close()
        except:
            pass

# =============================
# 靜態檔案與前端頁面
# =============================

# 專案根（C:\StockWebPage）
FRONTEND_DIR = Path(os.getenv("FRONTEND_DIR", r"C:\StockWebPage")).resolve()
STATIC_DIR = FRONTEND_DIR / "static"

# /static/* 若資料夾存在才 mount，避免「目錄不存在」錯
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# 直接把整個前端資料夾掛在根路徑（html=True 讓 / 與 /index.html 都能出）
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn, threading, webbrowser, time, os

    HOST = os.getenv("HOST", "140.136.151.86")
    PORT = int(os.getenv("PORT", "8000"))
    URL  = f"http://{HOST}:{PORT}/"

    # 啟動前先測一次 DB，失敗就不要啟動http://140.136.151.86/（你也可以改成只印警告）
    try:
        cn = pool.get_connection()
        with cn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
        cn.close()
        print("[DB] 連線成功")
    except Exception as e:
        print(f"[DB] 連線失敗：{e}")
        raise

    # 伺服器啟動後自動開瀏覽器
    def _open():
        time.sleep(1.2)
        try:
            webbrowser.open(URL)  # 預設會開到 / ，index.html 會自動送出
        except Exception as e:
            print(f"[WARN] 無法自動開啟瀏覽器：{e}")

    threading.Thread(target=_open, daemon=True).start()
    uvicorn.run(app, host="140.136.151.86", port=8000, reload=False)
