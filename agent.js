// ============================================
// HOTSPOT PC AGENT - Windows 11
// Inaunganisha Cloud Server na Huawei AX3S
// Inafanya kazi background bila kufanya kitu
// ============================================

const axios = require('axios');
const crypto = require('crypto');

// ============ CONFIGURATION ============
const CONFIG = {
  SERVER_URL:    process.env.SERVER_URL    || 'https://YOUR-APP.onrender.com',
  AGENT_KEY:     process.env.AGENT_KEY     || 'BADILISHA-KEY-HII',
  ROUTER_IP:     process.env.ROUTER_IP     || '192.168.3.1',
  ROUTER_PASS:   process.env.ROUTER_PASS   || 'NYWILA-YA-ROUTER',
  CHECK_EVERY:   30000  // Angalia commands kila sekunde 30
};

let routerToken = null;
let tokenTime = null;
const TOKEN_TTL = 4 * 60 * 1000; // Token inaisha baada ya dakika 4

// ============ ROUTER LOGIN ============
async function loginRouter() {
  try {
    // Huawei AX3S uses SHA256 hashed password
    const passHash = crypto
      .createHash('sha256')
      .update(CONFIG.ROUTER_PASS)
      .digest('hex')
      .toUpperCase();

    const res = await axios.post(
      `http://${CONFIG.ROUTER_IP}/api/system/user_login`,
      { password: passHash },
      { 
        timeout: 10000,
        headers: { 'Content-Type': 'application/json' }
      }
    );

    if (res.data && res.data.token) {
      routerToken = res.data.token;
      tokenTime = Date.now();
      log('✅ Router login OK');
      return true;
    }

    // Some Huawei versions use cookies
    if (res.headers['set-cookie']) {
      routerToken = res.headers['set-cookie'][0].split(';')[0];
      tokenTime = Date.now();
      log('✅ Router login OK (cookie)');
      return true;
    }

    log('⚠️ Login response unusual: ' + JSON.stringify(res.data));
    return false;
  } catch (err) {
    log('❌ Router login failed: ' + err.message);
    return false;
  }
}

// ============ ENSURE VALID TOKEN ============
async function ensureToken() {
  const tokenExpired = !tokenTime || (Date.now() - tokenTime) > TOKEN_TTL;
  if (!routerToken || tokenExpired) {
    return await loginRouter();
  }
  return true;
}

// ============ CONTROL DEVICE ============
async function controlDevice(mac, allow) {
  try {
    const ok = await ensureToken();
    if (!ok) {
      log(`❌ Cannot control ${mac} - login failed`);
      return false;
    }

    const action = allow ? 1 : 0;
    
    // Try Huawei AX3S API endpoint
    const res = await axios.post(
      `http://${CONFIG.ROUTER_IP}/api/system/device_manage`,
      {
        mac_address: mac,
        enable_internet: action
      },
      {
        timeout: 10000,
        headers: {
          'Cookie': routerToken,
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/json',
          'Referer': `http://${CONFIG.ROUTER_IP}/`
        }
      }
    );

    if (res.data && (res.data.errcode === 0 || res.data.result === 'success')) {
      log(`${allow ? '✅ ALLOWED' : '⛔ BLOCKED'} MAC: ${mac}`);
      return true;
    }

    log(`⚠️ Control response: ${JSON.stringify(res.data)}`);
    
    // Reset token on failure
    routerToken = null;
    return false;

  } catch (err) {
    log(`❌ Control failed for ${mac}: ${err.message}`);
    routerToken = null; // Will re-login next time
    return false;
  }
}

// ============ PROCESS COMMANDS FROM SERVER ============
async function processCommands() {
  try {
    const res = await axios.get(
      `${CONFIG.SERVER_URL}/api/agent/commands`,
      {
        headers: { 'x-agent-key': CONFIG.AGENT_KEY },
        timeout: 15000
      }
    );

    const commands = res.data;
    
    if (commands.length > 0) {
      log(`📋 ${commands.length} command(s) to process`);
    }

    for (const cmd of commands) {
      const allow = cmd.action === 'allow';
      const success = await controlDevice(cmd.mac_address, allow);

      if (success) {
        // Mark command as done
        await axios.post(
          `${CONFIG.SERVER_URL}/api/agent/commands/${cmd.id}/done`,
          {},
          {
            headers: { 'x-agent-key': CONFIG.AGENT_KEY },
            timeout: 10000
          }
        );
        log(`✔ Command ${cmd.id} marked done`);
      }
    }
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      log('🌐 Server unreachable - will retry...');
    } else {
      log(`❌ Command error: ${err.message}`);
    }
  }
}

// ============ LOGGER ============
function log(msg) {
  const time = new Date().toLocaleTimeString('sw-TZ');
  console.log(`[${time}] ${msg}`);
}

// ============ MAIN ============
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║     HOTSPOT PC AGENT - Tanzania      ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  log(`📡 Router: ${CONFIG.ROUTER_IP}`);
  log(`☁️  Server: ${CONFIG.SERVER_URL}`);
  log(`⏱️  Check every: ${CONFIG.CHECK_EVERY/1000}s`);
  console.log('');

  // Initial router login
  await loginRouter();

  // Process commands immediately
  await processCommands();

  // Then every 30 seconds
  setInterval(processCommands, CONFIG.CHECK_EVERY);
}

main().catch(err => {
  log('❌ Fatal error: ' + err.message);
  process.exit(1);
});
