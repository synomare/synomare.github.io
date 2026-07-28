/* ============================================================
   synomare — effects layer (裏写りの物理)
   1. SYN.grain()      — live film grain (Canvas2D, replaces static CSS grain)
   2. SYN.flowImage()  — WebGL cursor-flowmap displacement on plates;
                         the negative (verso) bleeds through where touched
   3. SYN.embers()     — burning tear edge: phosphor/gilt ember line +
                         rising ash particles, riding --seamp
   All effects degrade silently: reduced motion, coarse pointers,
   missing WebGL → the page stands on CSS alone.
   ============================================================ */
(function () {
  'use strict';

  var SYN = window.SYN = window.SYN || {};
  var reduced = SYN.prefersReduced;

  /* ---------- 0. frame budget watchdog ----------
     A full-viewport blended layer costs a whole-screen recomposite on
     every frame beneath it changes. That is cheap on a GPU and ruinous
     without one, so measure the real budget and shed the most expensive
     ornament rather than shipping a slideshow to weaker machines.
     Degradation is one-way: no oscillating between modes. */
  var budget = { degraded: false, cbs: [] };
  SYN.onDegrade = function (cb) { if (budget.degraded) cb(); else budget.cbs.push(cb); };
  (function watchdog() {
    if (reduced) return;
    var WINDOW = 60, SLOW_MS = 26, RATIO = 0.55;
    var ring = new Array(WINDOW), n = 0, slow = 0, last = 0;
    function tick(t) {
      var dt = last ? t - last : 0;
      last = t;
      /* ignore tab-switch stalls and the very first frames after load */
      if (dt > 0 && dt < 400 && t > 1500) {
        var isSlow = dt > SLOW_MS ? 1 : 0;
        var i = n % WINDOW;
        if (n >= WINDOW) slow -= ring[i];
        ring[i] = isSlow;
        slow += isSlow;
        n++;
        if (n >= WINDOW && slow / WINDOW > RATIO) {
          budget.degraded = true;
          document.documentElement.classList.add('perf-lite');
          for (var k = 0; k < budget.cbs.length; k++) budget.cbs[k]();
          budget.cbs.length = 0;
          return; /* one-way: never oscillate back */
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  })();

  /* ---------- 1. live grain ---------- */
  SYN.grain = function () {
    if (reduced) return;
    var c = document.createElement('canvas');
    c.className = 'live-grain';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
    document.body.classList.add('has-live-grain');
    var ctx = c.getContext('2d');
    if (!ctx) { c.remove(); document.body.classList.remove('has-live-grain'); return; }
    var w = 0, h = 0, img = null;
    function resize() {
      w = c.width = Math.max(1, Math.ceil(window.innerWidth / 8));
      h = c.height = Math.max(1, Math.ceil(window.innerHeight / 8));
      img = null;
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    /* on a machine that cannot afford the boil, fall back to the static
       CSS grain the site has always had — same texture, no per-frame cost */
    var retired = false;
    SYN.onDegrade(function () {
      retired = true;
      c.remove();
      document.body.classList.remove('has-live-grain');
    });

    var last = 0;
    function tick(t) {
      if (retired) return;
      /* a full-viewport blended layer is the most expensive thing on the
         page whenever anything beneath it animates — stand down during
         the seam, where the ember canvas supplies the texture anyway */
      if (document.body.classList.contains('seam-active')) {
        if (!c.hidden) c.hidden = true;
        requestAnimationFrame(tick);
        return;
      }
      if (c.hidden) c.hidden = false;
      if (!document.hidden && t - last > 110) {
        last = t;
        if (!img) img = ctx.createImageData(w, h);
        var d = img.data;
        for (var i = 0; i < d.length; i += 4) {
          var v = 210 + ((Math.random() * 45) | 0);
          d[i] = d[i + 1] = d[i + 2] = v;
          d[i + 3] = 255;
        }
        /* occasional one-frame vertical scratch — film damage */
        if (Math.random() < 0.035) {
          var x = (Math.random() * w) | 0;
          for (var y = 0; y < h; y++) {
            var k = (y * w + x) * 4;
            d[k] = d[k + 1] = d[k + 2] = 150;
          }
        }
        ctx.putImageData(img, 0, 0);
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  };

  /* ---------- 2. flowmap displacement ---------- */
  function compileProgram(gl, vsSrc, fsSrc) {
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return null;
      return s;
    }
    var vs = sh(gl.VERTEX_SHADER, vsSrc);
    var fs = sh(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
    return p;
  }

  var VS = 'attribute vec2 p;varying vec2 vUv;void main(){vUv=p*0.5+0.5;gl_Position=vec4(p,0.,1.);}';

  var FS_FLOW = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uFlow;',
    'uniform vec2 uMouse;',
    'uniform vec2 uVel;',
    'uniform float uAspect;',
    'void main(){',
    '  vec2 v=(texture2D(uFlow,vUv).rg-0.5)*2.0;',
    '  v*=0.935;',
    '  vec2 d=vUv-uMouse; d.x*=uAspect;',
    '  float inf=exp(-dot(d,d)/0.006);',
    '  v+=uVel*inf*2.4;',
    '  v=clamp(v,-1.0,1.0);',
    '  gl_FragColor=vec4(v*0.5+0.5,0.0,1.0);',
    '}'
  ].join('\n');

  var FS_DRAW = [
    'precision mediump float;',
    'varying vec2 vUv;',
    'uniform sampler2D uImage;',
    'uniform sampler2D uFlow;',
    'uniform vec2 uScale;',
    'uniform vec2 uShift;',
    'uniform float uRgb;',
    'void main(){',
    '  vec2 flow=(texture2D(uFlow,vUv).rg-0.5)*2.0;',
    '  float mag=length(flow);',
    '  vec2 uv=vUv*uScale+uShift;',
    '  uv-=flow*0.021*uScale;',
    '  vec2 cuv=clamp(uv,0.001,0.999);',
    '  vec4 col=texture2D(uImage,cuv);',
    '  if(uRgb>0.5){',
    '    col.r=texture2D(uImage,clamp(uv-flow*0.010,0.001,0.999)).r;',
    '    col.b=texture2D(uImage,clamp(uv+flow*0.010,0.001,0.999)).b;',
    '  }',
    '  vec3 neg=1.0-col.rgb;',
    '  neg*=vec3(0.92,0.86,0.78);', /* bone-warm negative */
    '  float show=smoothstep(0.55,1.4,mag)*0.7;',
    '  gl_FragColor=vec4(mix(col.rgb,neg,show),1.0);',
    '}'
  ].join('\n');

  SYN.flowImage = function (img, container, opts) {
    opts = opts || {};
    if (reduced || !img || !container) return null;
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return null;

    var canvas = document.createElement('canvas');
    canvas.className = 'gl-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    var gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return null;

    var progFlow = compileProgram(gl, VS, FS_FLOW);
    var progDraw = compileProgram(gl, VS, FS_DRAW);
    if (!progFlow || !progDraw) return null;

    var quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    function attrib(prog) {
      var loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    }

    /* flow ping-pong targets */
    var FLOW_SIZE = 144;
    function makeTarget() {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      var init = new Uint8Array(FLOW_SIZE * FLOW_SIZE * 4);
      for (var i = 0; i < init.length; i += 4) { init[i] = 128; init[i + 1] = 128; init[i + 3] = 255; }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, FLOW_SIZE, FLOW_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, init);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex: tex, fb: fb };
    }
    var flowA = makeTarget();
    var flowB = makeTarget();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    /* image texture */
    var imgTex = gl.createTexture();
    var imgW = 1, imgH = 1, ready = false;
    function uploadImage() {
      gl.bindTexture(gl.TEXTURE_2D, imgTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      } catch (e) { return; }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      imgW = img.naturalWidth || 1;
      imgH = img.naturalHeight || 1;
      ready = true;
    }
    if (img.complete && img.naturalWidth) uploadImage();
    else img.addEventListener('load', uploadImage);

    container.appendChild(canvas);

    var objPos = opts.objectPosition || [0.5, 0.5];
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var cw = 0, ch = 0;
    function resize() {
      var r = container.getBoundingClientRect();
      cw = Math.max(1, Math.round(r.width * dpr));
      ch = Math.max(1, Math.round(r.height * dpr));
      canvas.width = cw;
      canvas.height = ch;
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    /* cover-fit mapping (mirrors CSS object-fit: cover) */
    function coverUniforms() {
      var cAspect = cw / ch, iAspect = imgW / imgH;
      var sx, sy;
      if (cAspect > iAspect) { sx = 1; sy = iAspect / cAspect; }
      else { sx = cAspect / iAspect; sy = 1; }
      /* scale of uv region: image occupies full canvas; uv->image needs inverse */
      var scaleX = sx, scaleY = sy;
      var shiftX = (1 - sx) * objPos[0];
      var shiftY = (1 - sy) * (1 - objPos[1]);
      return [scaleX, scaleY, shiftX, shiftY];
    }

    var mouse = [0.5, 0.5], lastMouse = null, vel = [0, 0], active = false, visible = true, raf = null, idle = 0;

    function frame() {
      raf = null;
      if (!ready || !visible) { idle = 0; return; }

      /* flow update */
      gl.useProgram(progFlow);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      attrib(progFlow);
      gl.viewport(0, 0, FLOW_SIZE, FLOW_SIZE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, flowB.fb);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, flowA.tex);
      gl.uniform1i(gl.getUniformLocation(progFlow, 'uFlow'), 0);
      gl.uniform2f(gl.getUniformLocation(progFlow, 'uMouse'), mouse[0], 1 - mouse[1]);
      gl.uniform2f(gl.getUniformLocation(progFlow, 'uVel'), vel[0], -vel[1]);
      gl.uniform1f(gl.getUniformLocation(progFlow, 'uAspect'), cw / ch);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      var t = flowA; flowA = flowB; flowB = t;
      vel[0] *= 0.82; vel[1] *= 0.82;

      /* draw */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
      gl.useProgram(progDraw);
      attrib(progDraw);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, imgTex);
      gl.uniform1i(gl.getUniformLocation(progDraw, 'uImage'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, flowA.tex);
      gl.uniform1i(gl.getUniformLocation(progDraw, 'uFlow'), 1);
      var cu = coverUniforms();
      gl.uniform2f(gl.getUniformLocation(progDraw, 'uScale'), cu[0], cu[1]);
      gl.uniform2f(gl.getUniformLocation(progDraw, 'uShift'), cu[2], cu[3]);
      gl.uniform1f(gl.getUniformLocation(progDraw, 'uRgb'), opts.rgbShift ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      canvas.style.opacity = '1';

      if (active) idle = 0; else idle++;
      if (idle < 90) raf = requestAnimationFrame(frame);
    }

    function wake() { if (!raf) { idle = 0; raf = requestAnimationFrame(frame); } }

    container.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var r = container.getBoundingClientRect();
      var mx = (e.clientX - r.left) / r.width;
      var my = (e.clientY - r.top) / r.height;
      if (lastMouse) {
        vel[0] += (mx - lastMouse[0]) * 1.6;
        vel[1] += (my - lastMouse[1]) * 1.6;
      }
      lastMouse = [mx, my];
      mouse = [mx, my];
      active = true;
      wake();
    }, { passive: true });
    container.addEventListener('pointerleave', function () { active = false; lastMouse = null; });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) {
        visible = en[0].isIntersecting;
        /* an off-screen WebGL layer still costs compositing on every frame
           the page paints — drop it out of the tree, not just the rAF loop */
        canvas.hidden = !visible;
        if (visible) wake();
      }).observe(container);
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden && visible) wake(); });

    return { canvas: canvas };
  };

  /* ---------- 3. tear embers ---------- */
  /* jag profile — must match the .seam-recto clip-path */
  var JAGS = [
    [1.0, 0.0], [0.966, 0.7], [0.932, -0.8], [0.898, 1.5], [0.864, -0.4],
    [0.83, 0.9], [0.796, -1.3], [0.762, 0.3], [0.728, -0.6], [0.694, 1.2],
    [0.66, -0.2], [0.626, 0.8], [0.592, -1.1], [0.558, 0.4], [0.524, -0.5],
    [0.49, 1.4], [0.456, -0.9], [0.422, 0.2], [0.388, -1.2], [0.354, 0.6],
    [0.32, -0.3], [0.286, 1.0], [0.252, -0.7], [0.218, 0.5], [0.184, -1.0],
    [0.15, 0.9], [0.116, -0.4], [0.082, 1.1], [0.048, -0.6], [0.016, 0.3], [0.0, -0.2]
  ];

  SYN.embers = function (stage) {
    if (reduced || !stage) return;
    var canvas = document.createElement('canvas');
    canvas.className = 'ember-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    stage.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    if (!ctx) { canvas.remove(); return; }

    /* half-resolution: the ember line is a glow, not a hairline —
       the canvas is the single most expensive layer on the page */
    var SCALE = 0.5;
    var W = 0, H = 0;
    function resize() {
      var r = stage.getBoundingClientRect();
      W = canvas.width = Math.max(1, Math.round(r.width * SCALE));
      H = canvas.height = Math.max(1, Math.round(r.height * SCALE));
    }
    resize();
    window.addEventListener('resize', resize, { passive: true });

    var particles = [];
    var lastP = 0;
    var visible = true;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { visible = en[0].isIntersecting; }).observe(stage);
    }

    function edgeY(p, xFrac) {
      var vh = H / 100;
      var base = (1 - p) * 1.24 * H - 0.12 * H;
      /* piecewise-linear jag interpolation */
      for (var i = 0; i < JAGS.length - 1; i++) {
        var a = JAGS[i], b = JAGS[i + 1];
        if (xFrac <= a[0] && xFrac >= b[0]) {
          var t = (a[0] - xFrac) / (a[0] - b[0] || 1);
          return base + (a[1] + (b[1] - a[1]) * t) * vh;
        }
      }
      return base;
    }

    function spawn(p, rate) {
      for (var i = 0; i < rate; i++) {
        if (particles.length > 130) return;
        var xf = Math.random();
        particles.push({
          x: xf * W,
          y: edgeY(p, xf),
          vx: (Math.random() - 0.5) * 0.5,
          vy: -(0.4 + Math.random() * 1.4),
          life: 1,
          decay: 0.006 + Math.random() * 0.016,
          size: (Math.random() < 0.82 ? 1.6 : 2.6) * SCALE + 0.5,
          gold: Math.random() < 0.3
        });
      }
    }

    var lastFrame = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      if (!visible || document.hidden) return;
      /* embers are texture, not motion — 30fps is plenty and halves the cost */
      if (now - lastFrame < 32) return;
      lastFrame = now;

      var p = parseFloat(stage.style.getPropertyValue('--seamp')) || 0;
      var burning = p > 0.002 && p < 0.998;
      var moving = Math.abs(p - lastP);

      ctx.clearRect(0, 0, W, H);

      if (burning) {
        /* ember line — hot core over soft glow, alpha flickers */
        var flick = 0.75 + Math.random() * 0.25;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (var pass = 0; pass < 2; pass++) {
          ctx.beginPath();
          for (var i = 0; i < JAGS.length; i++) {
            var x = JAGS[i][0] * W;
            var y = edgeY(p, JAGS[i][0]);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          if (pass === 0) {
            ctx.strokeStyle = 'rgba(255,59,35,' + (0.10 * flick).toFixed(3) + ')';
            ctx.lineWidth = 12 * SCALE;
          } else {
            ctx.strokeStyle = 'rgba(255,140,60,' + (0.5 * flick).toFixed(3) + ')';
            ctx.lineWidth = Math.max(1, 1.4 * SCALE);
          }
          ctx.stroke();
        }
        spawn(p, moving > 0.0004 ? 4 : (Math.random() < 0.2 ? 1 : 0));
        ctx.restore();
      }

      /* ash */
      if (particles.length) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (var j = particles.length - 1; j >= 0; j--) {
          var pt = particles[j];
          pt.x += pt.vx + Math.sin(pt.y * 0.02 + pt.x * 0.01) * 0.3;
          pt.y += pt.vy;
          pt.life -= pt.decay;
          if (pt.life <= 0 || pt.y < -10) { particles.splice(j, 1); continue; }
          var a = pt.life * 0.8;
          ctx.fillStyle = pt.gold
            ? 'rgba(201,164,92,' + a.toFixed(3) + ')'
            : 'rgba(255,80,40,' + a.toFixed(3) + ')';
          ctx.fillRect(pt.x, pt.y, pt.size, pt.size);
        }
        ctx.restore();
      }

      lastP = p;
    }
    requestAnimationFrame(frame);
  };
})();
