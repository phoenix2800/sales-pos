#!/bin/bash
clear
echo "============================================================"
echo "   SALES & INVENTORY MANAGEMENT SYSTEM"
echo "   SYSTÈME DE GESTION DES VENTES"
echo "   نظام إدارة المبيعات ونقاط البيع"
echo "============================================================"
echo ""
echo "  [1] LOCAL MODE  (Same WiFi only - FAST, STABLE)"
echo "      Phones must be on the same WiFi as this computer"
echo ""
echo "  [2] PUBLIC MODE (Any phone, anywhere - Internet)"
echo "      Phones can be on 4G/5G or different WiFi"
echo ""
echo "============================================================"
echo ""
read -p "Choose mode (1 or 2), press Enter for 1: " choice

if [ "$choice" = "2" ]; then
  echo ""
  echo "Starting in PUBLIC mode (with internet tunnel)..."
  echo ""
  npm install --production --silent
  echo ""
  node tunnel.js
else
  echo ""
  echo "Starting in LOCAL mode..."
  echo ""
  npm install --production --silent
  echo ""
  echo "============================================================"
  echo " Server running!"
  echo ""
  echo " On this computer:"
  echo "   Admin:   http://localhost:3001/admin/"
  echo "   POS:     http://localhost:3001/pos/"
  echo ""
  echo " Phones on same WiFi: use this computer's local IP"
  echo "============================================================"
  echo ""
  node src/index.js
fi
