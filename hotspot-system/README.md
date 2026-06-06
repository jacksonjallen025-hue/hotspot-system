# 📶 KARIBU NET — Tanzania WiFi Hotspot System

## Files za Mfumo

| File | Kazi |
|------|------|
| `server.js` | Main server - malipo, sessions, API |
| `public/portal.html` | Ukurasa wa malipo (wateja wanaona hii) |
| `public/admin.html` | Dashboard ya admin |
| `agent.js` | PC Agent - inasimamia router |
| `install-agent.bat` | Installer ya Windows |
| `.env.example` | Template ya environment variables |

## Hatua za Setup

### 1. Render.com (Cloud Server)
- Deploy server hii kwenye Render
- Ongeza PostgreSQL database
- Weka environment variables

### 2. Environment Variables kwenye Render
```
DATABASE_URL      = (Render inatoa automatically)
SERVER_URL        = https://your-app.onrender.com
ADMIN_KEY         = (nywila yako ya admin)
AGENT_SECRET_KEY  = (key ya agent - lazima iwe sawa)
SELCOM_VENDOR_ID  = (kutoka Selcom)
SELCOM_API_KEY    = (kutoka Selcom)
SELCOM_API_SECRET = (kutoka Selcom)
```

### 3. PC Agent (Windows 11)
- Download folder ya `agent.js` kwenye PC
- Run `install-agent.bat` kama Administrator
- Badilisha SERVER_URL, AGENT_KEY, ROUTER_PASS

### 4. Router (Huawei AX3S)
- Badilisha DNS kwenye LAN settings → IP ya server
- WiFi iwe Open (bila password)

### 5. Selcom
- Register: selcom.net
- Pata API credentials
- Weka webhook URL: https://your-app.onrender.com/api/payment/callback

## Admin Dashboard
```
https://your-app.onrender.com/admin?key=ADMIN_KEY_YAKO
```
