@echo off
setlocal
cd /d %~dp0
if not exist venv (
  python -m venv venv
)
call venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
set CRYPT_USER=Myfriend
set CRYPT_PASS=Cripto
set CRYPT_SECRET=dev-secret-change-me
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
