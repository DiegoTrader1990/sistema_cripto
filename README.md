# Deribit GEX Desk PRO v7.7 QT (PRO)

Esta versão troca Tkinter/Matplotlib por **Qt + pyqtgraph** para ter:
- Zoom / pan / crosshair / hover (nível TradingView-like)
- Clique no GEX (barra) -> seleciona strike e atualiza cards + Trade Planner
- Cards operacionais (Context, Action, Strategy, Trade Planner)

## Rodar (Windows)
1) Extraia o ZIP
2) python -m venv venv
3) venv\Scripts\activate
4) pip install -r requirements.txt
5) python app.py

## Notas
- LIVE consulta Deribit (pode variar conforme rede/latência).
- Para desempenho, o chain é cacheado e atualizado com intervalo (config).
- Logs em logs/app.log e logs/crash.log
