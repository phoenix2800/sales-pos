/**
 * Start the server AND a public tunnel automatically.
 * Use this when you need phones on DIFFERENT networks (not same WiFi) to access the POS.
 * 
 * Usage: node tunnel.js
 */

const localtunnel = require('localtunnel');
const QRCode = require('qrcode');
const path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3001;
const SUBDOMAIN = ''; // leave empty for random, or set a fixed one (e.g. 'myshop-pos' if available)

console.log('\n' + '='.repeat(60));
console.log('  🚀 SALES & INVENTORY SYSTEM - PUBLIC MODE');
console.log('  (Server + Public Internet Tunnel)');
console.log('='.repeat(60) + '\n');

// Start the server as a child process
const server = spawn('node', ['src/index.js'], {
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env, PORT: String(PORT) }
});

// Wait a moment for server to start, then start the tunnel
setTimeout(async () => {
  try {
    console.log('\n🌐 Creating public internet tunnel...\n');
    
    const tunnelOpts = { port: PORT };
    if (SUBDOMAIN) tunnelOpts.subdomain = SUBDOMAIN;
    
    const tunnel = await localtunnel(tunnelOpts);

    const posUrl = `${tunnel.url}/pos/`;
    const adminUrl = `${tunnel.url}/admin/`;

    console.log('✅ TUNNEL ACTIVE! Public URLs:');
    console.log('-'.repeat(60));
    console.log(`\n📱 POS URL (for phones anywhere):`);
    console.log(`   ${posUrl}\n`);
    console.log(`🖥️  Admin URL (for computers anywhere):`);
    console.log(`   ${adminUrl}\n`);
    console.log(`💻 Local URL (same computer):`);
    console.log(`   http://localhost:${PORT}/admin/\n`);

    // Generate QR code to file
    const qrPath = path.join(__dirname, 'pos-qr.png');
    await QRCode.toFile(qrPath, posUrl, {
      width: 500,
      margin: 2,
      color: { dark: '#4f46e5', light: '#ffffff' }
    });
    console.log(`📲 QR Code saved to: ${qrPath}`);
    console.log('   (Open that image on your computer and scan with any phone camera)\n');
    console.log('-'.repeat(60));
    console.log('⚠️  IMPORTANT NOTES:');
    console.log('   • Keep this window OPEN while using the system');
    console.log('   • The URL changes every time you restart (free tier)');
    console.log('   • First time you open the URL on a phone, click "Click to Continue"');
    console.log('   • Login: admin/admin123  or  vendor/vendor123');
    console.log('-'.repeat(60) + '\n');

    tunnel.on('close', () => {
      console.log('❌ Tunnel closed. Restart to get a new public URL.');
    });

    tunnel.on('error', (err) => {
      console.error('❌ Tunnel error:', err.message);
    });

    process.on('SIGINT', () => {
      tunnel.close();
      server.kill();
      process.exit(0);
    });

  } catch (err) {
    console.error('❌ Failed to start tunnel:', err.message);
    console.log('\nThe local server is still running. You can still use it on:');
    console.log(`   http://localhost:${PORT}/admin/`);
    console.log('   (phones on same WiFi use your computer IP)');
  }
}, 3000);
