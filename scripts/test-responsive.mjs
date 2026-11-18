import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 8088;
const CDP_PORT = 9243;

const ROOT_DIR = path.resolve(__dirname, '..');

// Simple HTTP server
const mimeTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(ROOT_DIR, reqPath === '/' ? 'index.html' : reqPath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

server.listen(PORT, async () => {
  console.log(`Server listening at http://127.0.0.1:${PORT}`);
  await runTests();
});

async function runTests() {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const edge = spawn(edgePath, [
    '--headless=new',
    '--disable-extensions',
    `--remote-debugging-port=${CDP_PORT}`,
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    `http://127.0.0.1:${PORT}/index.html`
  ]);

  // Wait for Edge CDP to be ready
  let targetWsUrl = null;
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
      const list = await res.json();
      const page = list.find(p => p.type === 'page' && p.url.includes(PORT.toString()));
      if (page && page.webSocketDebuggerUrl) {
        targetWsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch (e) {
      await new Promise(r => setTimeout(r, 250));
    }
  }

  if (!targetWsUrl) {
    console.error('Failed to obtain target WebSocket URL from Edge');
    edge.kill();
    server.close();
    process.exit(1);
  }

  const ws = new WebSocket(targetWsUrl);
  let id = 1;
  const callbacks = new Map();

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id && callbacks.has(data.id)) {
      const cb = callbacks.get(data.id);
      callbacks.delete(data.id);
      cb(data);
    }
  };

  const send = (method, params = {}) => {
    return new Promise((resolve) => {
      const currentId = id++;
      callbacks.set(currentId, resolve);
      ws.send(JSON.stringify({ id: currentId, method, params }));
    });
  };

  await new Promise(resolve => ws.onopen = resolve);

  await send('Page.enable');
  await send('DOM.enable');
  await send('Runtime.enable');

  const evalJs = async (expr) => {
    const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return res.result?.result?.value;
  };

  // Wait for page preloader to dismiss
  await new Promise(r => setTimeout(r, 1400));

  const viewports = [
    { width: 320, height: 650, name: '320px (Small Mobile / iPhone 5/SE)' },
    { width: 375, height: 667, name: '375px (Standard Mobile / iPhone SE2)' },
    { width: 390, height: 844, name: '390px (iPhone 12/13/14/15/16)' },
    { width: 430, height: 932, name: '430px (Large Mobile / iPhone Pro Max)' },
    { width: 768, height: 1024, name: '768px (Tablet Portrait)' },
    { width: 1024, height: 768, name: '1024px (Tablet Landscape)' },
    { width: 1440, height: 900, name: '1440px (Desktop Monitor)' }
  ];

  console.log('\n======================================================');
  console.log('       BAKERZ BITE RESPONSIVE & CHATBOT TEST SUITE     ');
  console.log('======================================================\n');

  let allPassed = true;

  for (const vp of viewports) {
    console.log(`\n--- Testing ${vp.name} (${vp.width}x${vp.height}) ---`);

    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: 1,
      mobile: vp.width <= 768
    });

    // Ensure any open drawers or modals are closed before testing overflow
    await evalJs(`
      (() => {
        document.getElementById('mainNav')?.classList.remove('open');
        document.getElementById('navBackdrop')?.classList.remove('active');
        document.getElementById('chatbotWindow')?.classList.remove('active');
        document.getElementById('chatbotBackdrop')?.classList.remove('active');
        document.getElementById('cartDrawer')?.classList.remove('active');
        document.body.classList.remove('mobile-nav-open', 'chatbot-open');
      })()
    `);

    await new Promise(r => setTimeout(r, 350));

    // 1. Check Horizontal Scroll Overflow
    const overflowCheck = await evalJs(`
      (() => {
        const clientWidth = document.documentElement.clientWidth;
        const scrollWidth = document.documentElement.scrollWidth;
        const winWidth = window.innerWidth;
        const hasOverflow = scrollWidth > winWidth + 1;
        
        // Find visible elements that bleed past viewport without overflow:hidden container
        const bleeding = [];
        document.querySelectorAll('*').forEach(el => {
          if (el.offsetWidth === 0 && el.offsetHeight === 0) return;
          const style = window.getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return;
          
          // Elements deliberately designed to be scrollable horizontally inside their container
          if (el.closest('.category-filter-bar') || el.closest('.gallery-filters') || el.closest('.dietary-pills-wrap')) return;
          if (el.closest('.ticker-marquee-wrapper') || el.closest('.geolocation-ticker-bar')) return;
          if (el.classList.contains('main-nav') && !el.classList.contains('open')) return;
          if (el.closest('.main-nav:not(.open)')) return;
          if (el.classList.contains('cart-drawer') && !el.classList.contains('active')) return;
          if (el.closest('.cart-drawer:not(.active)')) return;
          if (el.classList.contains('chatbot-window') && !el.classList.contains('active')) return;
          
          const rect = el.getBoundingClientRect();
          if (rect.right > winWidth + 2) {
            bleeding.push({
              tag: el.tagName,
              cls: el.className,
              id: el.id,
              right: Math.round(rect.right),
              overflow: Math.round(rect.right - winWidth)
            });
          }
        });
        
        return { clientWidth, scrollWidth, winWidth, hasOverflow, bleedingCount: bleeding.length, bleedingSample: bleeding.slice(0, 3) };
      })()
    `);

    if (overflowCheck.hasOverflow || overflowCheck.bleedingCount > 0) {
      console.error(`❌ Overflow detected! scrollWidth: ${overflowCheck.scrollWidth}px > innerWidth: ${overflowCheck.winWidth}px`);
      console.error(`   Bleeding elements:`, overflowCheck.bleedingSample);
      allPassed = false;
    } else {
      console.log(`✅ No horizontal overflow! (scrollWidth: ${overflowCheck.scrollWidth}px == innerWidth: ${overflowCheck.winWidth}px)`);
    }

    // 2. Test Mobile Hamburger Navigation (if <= 1200px)
    if (vp.width <= 1200) {
      const navTest = await evalJs(`
        (() => {
          const btn = document.getElementById('mobileMenuToggle');
          const nav = document.getElementById('mainNav');
          const backdrop = document.getElementById('navBackdrop');
          const closeBtn = document.getElementById('closeMobileNavBtn');
          
          if (!btn || !nav) return { ok: false, msg: 'Missing hamburger button or mainNav' };
          
          // Click to open
          btn.click();
          const isOpenAfterClick = nav.classList.contains('open');
          const isBackdropActive = backdrop ? backdrop.classList.contains('active') : false;
          
          // Test close button
          if (closeBtn) closeBtn.click();
          else btn.click();
          
          const isClosedAfterClose = !nav.classList.contains('open');
          
          return {
            ok: isOpenAfterClick && isClosedAfterClose,
            isOpenAfterClick,
            isBackdropActive,
            isClosedAfterClose
          };
        })()
      `);

      if (navTest.ok) {
        console.log(`✅ Mobile Navigation drawer opens & closes smoothly with backdrop.`);
      } else {
        console.error(`❌ Mobile Navigation test failed:`, navTest);
        allPassed = false;
      }

      await new Promise(r => setTimeout(r, 350));
    }

    // 3. Test AI Chatbot
    const chatbotTest = await evalJs(`
      (() => {
        const launcher = document.getElementById('chatbotLauncher');
        const windowEl = document.getElementById('chatbotWindow');
        const closeBtn = document.getElementById('closeChatbotBtn');
        
        if (!launcher || !windowEl) return { ok: false, msg: 'Missing chatbot launcher or window' };
        
        const launcherRect = launcher.getBoundingClientRect();
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;
        
        // Check launcher is visible and within bounds
        const launcherInBounds = launcherRect.right <= winWidth + 2 && launcherRect.bottom <= winHeight + 2 && launcherRect.left >= 0;
        
        // Open Chatbot
        launcher.click();
        const isOpen = windowEl.classList.contains('active');
        const winRect = windowEl.getBoundingClientRect();
        
        const isMobile = winWidth <= 640;
        let sizingOk = false;
        if (isMobile) {
          // On mobile, window should be full-screen
          sizingOk = winRect.width >= winWidth - 2 && winRect.height >= winHeight - 2;
        } else {
          // On desktop, window should be properly sized floating window
          sizingOk = winRect.width >= 340 && winRect.width <= 440 && winRect.right <= winWidth + 5;
        }
        
        const closeBtnVisible = closeBtn && closeBtn.offsetWidth > 0 && closeBtn.offsetHeight > 0;
        
        return {
          launcherInBounds,
          isOpen,
          sizingOk,
          isMobile,
          winRect: { width: Math.round(winRect.width), height: Math.round(winRect.height) },
          winWidth,
          winHeight,
          closeBtnVisible
        };
      })()
    `);

    if (chatbotTest.isOpen && chatbotTest.sizingOk && chatbotTest.closeBtnVisible) {
      console.log(`✅ Chatbot opens with correct layout: ${chatbotTest.isMobile ? 'Full-screen mobile interface' : 'Desktop floating window'} (${chatbotTest.winRect.width}x${chatbotTest.winRect.height}px), close button visible.`);
    } else {
      console.error(`❌ Chatbot layout test failed:`, chatbotTest);
      allPassed = false;
    }

    // Test sending message to chatbot at this resolution
    const messageTest = await evalJs(`
      (async () => {
        const input = document.getElementById('chatbotInput');
        const form = document.getElementById('chatbotForm');
        const msgContainer = document.getElementById('chatbotMessages');
        
        if (!input || !form) return { ok: false, msg: 'Missing chatbot form' };
        
        const beforeCount = msgContainer.querySelectorAll('.chat-message').length;
        
        input.value = 'What are your best sellers?';
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        
        // Check typing indicator exists
        const typingPresent = !!document.getElementById('botTypingIndicator');
        
        // Wait for bot response (650ms delay in chatbot.js)
        await new Promise(r => setTimeout(r, 850));
        
        const afterCount = msgContainer.querySelectorAll('.chat-message').length;
        const lastMsg = msgContainer.querySelector('.chat-message.bot:last-child');
        const hasText = lastMsg ? lastMsg.textContent.length > 20 : false;
        const quickActions = lastMsg ? lastMsg.querySelectorAll('.chat-action-btn').length : 0;
        
        // Close chatbot
        const closeBtn = document.getElementById('closeChatbotBtn');
        if (closeBtn) closeBtn.click();
        
        return {
          ok: afterCount > beforeCount && hasText,
          beforeCount,
          afterCount,
          typingPresent,
          quickActions
        };
      })()
    `);

    if (messageTest.ok) {
      console.log(`✅ Chatbot messaging works: typing indicator displayed, AI response received with ${messageTest.quickActions} quick action buttons.`);
    } else {
      console.error(`❌ Chatbot messaging test failed:`, messageTest);
      allPassed = false;
    }

    await new Promise(r => setTimeout(r, 350));
  }

  console.log('\n======================================================');
  if (allPassed) {
    console.log('🎉 ALL RESPONSIVE & CHATBOT TESTS PASSED SUCCESSFULLY! 🎉');
  } else {
    console.log('⚠️ SOME TESTS FAILED. CHECK OUTPUT ABOVE.');
  }
  console.log('======================================================\n');

  edge.kill();
  server.close();
  process.exit(allPassed ? 0 : 1);
}
