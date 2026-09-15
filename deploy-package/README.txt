==============================================================
  🛒 SALES & INVENTORY MANAGEMENT SYSTEM
  📱 Point de Vente Mobile / نظام نقاط البيع
==============================================================

▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
STEP 0 — ONE TIME SETUP
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

1. Install Node.js (free):
   • Download from https://nodejs.org (choose LTS version)
   • Install it (double-click the installer, click Next/Next/Finish)

2. Download this folder to your computer and extract the ZIP.


▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
STEP 1 — START THE PROGRAM
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

DOUBLE-CLICK the START file:
  • Windows → START.bat
  • Mac/Linux → start.sh (or open Terminal in this folder → type: ./start.sh)

You will see TWO options:

   [1] LOCAL MODE  → for phones on the SAME WiFi as this computer
                     (fastest, most reliable, no lag)

   [2] PUBLIC MODE → for phones on 4G/5G or DIFFERENT WiFi
                     (works from anywhere in the world, via internet tunnel)

Choose option 2 if phones are NOT on the same WiFi.


▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
STEP 2 — LOGIN
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

  🔐 Admin (full access):
      Username: admin      Password: admin123

  🔐 Vendor / Cashier (POS only, no cost prices visible):
      Username: vendor     Password: vendor123


▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
STEP 3 — CONNECT PHONES
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

MODE 1 (Same WiFi):
  1. Find your computer's local IP address:
     • Windows: Open Command Prompt → type: ipconfig
       Look for "IPv4 Address" (e.g., 192.168.1.15)
     • Mac: System Settings → Network → shows IP
     • Linux: Terminal → hostname -I

  2. On each phone/tablet, open Chrome/Safari and type:
       http://[YOUR-IP]:3001/pos/
     Example: http://192.168.1.15:3001/pos/

  3. Log in with vendor / vendor123


MODE 2 (Public / Any network):
  After starting, the black window will show a PUBLIC URL, like:
     https://random-name.loca.lt/pos/

  1. Copy that URL
  2. A QR code image file (pos-qr.png) is also saved in the server folder
  3. On ANY phone (anywhere, 4G or WiFi), open the URL
  4. FIRST TIME ONLY: you may see a warning page → click "Click to Continue"
  5. Log in with vendor / vendor123

  NOTE: The public URL changes each time you restart the program.
  Open the new QR/URL on phones after each restart.

  IMPORTANT: Public mode uses a FREE tunnel service. It works great
  from home internet connections. If it ever fails, restart the program
  to get a new URL.


▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
DATA & BACKUP
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

  All your data (products, clients, sales, invoices) is saved in:
     server/data/database.sqlite

  Product images are saved in:
     server/uploads/

  BACKUP THESE TWO FOLDERS REGULARLY (copy to USB / Google Drive)!


▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬
LANGUAGES / LANGUES / اللغات
▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬

  The app supports 3 languages:
    🇬🇧 English  •  🇫🇷 Français  •  🇸🇦 العربية
  Click the 🌐 language button in the top-right corner to switch.
