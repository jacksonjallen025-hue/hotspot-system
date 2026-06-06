// ============================================
// HOTSPOT PC AGENT v4 - IP-based Control
// Inatafuta device kwa IP badala ya MAC
// ============================================

const axios = require('axios');
const puppeteer = require('puppeteer');

const CONFIG = {
  SERVER_URL:  'https://hotspot-system-2.onrender.com',
  AGENT_KEY:   'Agent@Secret2024',
  ROUTER_IP:   '192.168.3.1',
  ROUTER_PASS: '12345678L',
  CHECK_EVERY: 30000
};

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

// ============ LOGIN TO ROUTER ============
async function loginRouter(page) {
  try {
    log('📡 Inaingia router...');
    await page.goto(`http://${CONFIG.ROUTER_IP}/html/index.html#/login`, {
      waitUntil: 'networkidle2', timeout: 30000
    });
    await new Promise(r => setTimeout(r, 2000));

    await page.waitForSelector('#userpassword_ctrl', { timeout: 10000 });
    await page.click('#userpassword_ctrl');
    await page.type('#userpassword_ctrl', CONFIG.ROUTER_PASS, { delay: 50 });
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 4000));

    const url = page.url();
    if (!url.includes('login')) {
      log('✅ Imeingia router kikamilifu');
      return true;
    }

    // Try clicking by text
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        const text = (el.textContent || '').trim().toLowerCase();
        if (text === 'log in' || text === 'login') {
          el.click(); break;
        }
      }
    });
    await new Promise(r => setTimeout(r, 4000));

    const url2 = page.url();
    if (!url2.includes('login')) {
      log('✅ Imeingia router (click)');
      return true;
    }

    log('❌ Login imeshindwa');
    return false;
  } catch (err) {
    log(`❌ Login error: ${err.message}`);
    return false;
  }
}

// ============ CONTROL DEVICE BY IP ============
async function controlDeviceByIP(clientIP, allow) {
  let browser;
  try {
    log(`${allow ? '🔓 Inafungua' : '🔒 Inazuia'} IP: ${clientIP}`);

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setDefaultNavigationTimeout(30000);

    // Login
    const loggedIn = await loginRouter(page);
    if (!loggedIn) {
      await browser.close();
      return false;
    }

    // Get device list via router API (while logged in)
    log('📋 Inapata orodha ya devices...');
    
    const devices = await page.evaluate(async (routerIP) => {
      try {
        // Try to get connected devices
        const res = await fetch(`http://${routerIP}/api/system/connected_devices_info`);
        const data = await res.json();
        return { success: true, data };
      } catch(e) {
        return { success: false, error: e.message };
      }
    }, CONFIG.ROUTER_IP);

    log(`📊 Devices: ${JSON.stringify(devices).substring(0, 200)}`);

    if (devices.success && devices.data) {
      // Find device with matching IP
      const deviceList = devices.data.device_list || devices.data.clients || 
                         devices.data.devices || Object.values(devices.data);
      
      let targetMAC = null;
      
      if (Array.isArray(deviceList)) {
        for (const device of deviceList) {
          const devIP = device.ip || device.IP || device.ipAddress || device.ip_address;
          if (devIP === clientIP) {
            targetMAC = device.mac || device.MAC || device.macAddress || device.mac_address;
            log(`✅ Device inapatikana! MAC: ${targetMAC}`);
            break;
          }
        }
      }

      if (targetMAC) {
        // Control device via API
        const controlRes = await page.evaluate(async (routerIP, mac, action) => {
          try {
            const res = await fetch(`http://${routerIP}/api/system/device_manage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mac_address: mac, enable_internet: action })
            });
            return await res.json();
          } catch(e) {
            return { error: e.message };
          }
        }, CONFIG.ROUTER_IP, targetMAC, allow ? 1 : 0);

        log(`📡 Control jibu: ${JSON.stringify(controlRes)}`);
        
        if (controlRes.errcode === 0 || controlRes.result === 'success') {
          log(`✅ ${allow ? 'IMEFUNGULIWA' : 'IMEZUILIWA'}: ${clientIP}`);
          await browser.close();
          return true;
        }
      }
    }

    // Fallback: Use UI to control device
    log('🔄 Inajaribu njia ya UI...');
    await page.goto(
      `http://${CONFIG.ROUTER_IP}/html/index.html#/devicemanage`,
      { waitUntil: 'networkidle2', timeout: 20000 }
    );
    await new Promise(r => setTimeout(r, 5000));

    // Search by IP in the page
    const uiResult = await page.evaluate((targetIP, shouldAllow) => {
      const allEls = Array.from(document.querySelectorAll('*'));
      for (const el of allEls) {
        if (el.children.length > 3) continue; // Skip containers
        const text = (el.textContent || '').trim();
        if (text === targetIP) {
          // Found IP element - search parent for toggle
          let parent = el;
          for (let i = 0; i < 6; i++) {
            parent = parent.parentElement;
            if (!parent) break;
            const parentHTML = parent.innerHTML || '';
            if (parentHTML.includes(targetIP)) {
              const toggles = parent.querySelectorAll(
                '[class*="switch"], [class*="toggle"], input[type="checkbox"], [role="switch"]'
              );
              if (toggles.length > 0) {
                toggles[0].click();
                return { found: true, html: parent.innerHTML.substring(0, 200) };
              }
            }
          }
          return { found: true, noToggle: true };
        }
      }
      
      // Get all IPs visible on page for debugging
      const ips = [];
      allEls.forEach(el => {
        const t = (el.textContent || '').trim();
        if (/^192\.168\.\d+\.\d+$/.test(t)) ips.push(t);
      });
      return { found: false, visibleIPs: [...new Set(ips)] };
    }, clientIP, allow);

    log(`UI Result: ${JSON.stringify(uiResult)}`);

    if (uiResult.found) {
      await new Promise(r => setTimeout(r, 2000));
      log(`✅ ${allow ? 'IMEFUNGULIWA' : 'IMEZUILIWA'} via UI: ${clientIP}`);
      await browser.close();
      return true;
    }

    log(`⚠️ IPs zinaonekana: ${JSON.stringify(uiResult.visibleIPs)}`);
    await browser.close();
    return false;

  } catch (err) {
    log(`❌ Error: ${err.message}`);
    if (browser) await browser.close();
    return false;
  }
}

// ============ PROCESS COMMANDS ============
async function processCommands() {
  try {
    const res = await axios.get(
      `${CONFIG.SERVER_URL}/api/agent/commands`,
      { headers: { 'x-agent-key': CONFIG.AGENT_KEY }, timeout: 15000 }
    );

    const commands = res.data;
    if (commands.length > 0) log(`📋 Commands: ${commands.length}`);

    for (const cmd of commands) {
      // mac_address field now contains IP address
      const clientIP = cmd.mac_address;
      const ok = await controlDeviceByIP(clientIP, cmd.action === 'allow');
      
      if (ok) {
        await axios.post(
          `${CONFIG.SERVER_URL}/api/agent/commands/${cmd.id}/done`,
          {},
          { headers: { 'x-agent-key': CONFIG.AGENT_KEY } }
        );
        log(`✔ Command ${cmd.id} imekamilika`);
      }
    }
  } catch (err) {
    log(`🌐 ${err.message}`);
  }
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  KARIBU NET - PC AGENT v4 (IP-Based)    ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
  log(`📡 Router: ${CONFIG.ROUTER_IP}`);
  log(`☁️  Server: ${CONFIG.SERVER_URL}`);
  log(`⏱️  Kila sekunde: ${CONFIG.CHECK_EVERY/1000}`);
  log('✅ Agent imeanza - Inasubiri commands...');

  await processCommands();
  setInterval(processCommands, CONFIG.CHECK_EVERY);
}

main().catch(err => {
  log('❌ Fatal: ' + err.message);
  process.exit(1);
});
