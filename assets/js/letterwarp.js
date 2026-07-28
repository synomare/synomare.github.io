/* ============================================================
   synomare — letterwarp engine
   Grapheme-level typographic distortion:
   deterministic per-character warp, staggered reveal,
   pointer lens (geo/organic), scroll-velocity stretch,
   wear (forgetting) / lit (phosphor) states.

   Usage:
     var warp = SYN.letterwarp(rootEl, {
       tight: true,        // tighter leading/tracking
       fit: mainEl,        // binary-search font fitter (<=520px) against this container
       lens: true,         // pointer lens interaction
       velocity: true      // scroll-velocity vertical stretch (--vwarp on root)
     });
     warp.wear(0..1);      // hollow out characters below threshold (deterministic order)
     warp.lit(0..1);       // phosphor-light characters below threshold
   ============================================================ */
(function () {
  'use strict';

  window.SYN = window.SYN || {};
  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function letterwarp(root, opts) {
    if (!root) return null;
    opts = opts || {};
    if (opts.tight !== false) root.classList.add('tight');

    /* ---------- 1. grapheme splitter + deterministic warp ---------- */
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    var nodes = [];
    while (walker.nextNode()) { nodes.push(walker.currentNode); }

    function classify(cp) {
      if ((cp >= 0x0041 && cp <= 0x024F) || (cp >= 0x0030 && cp <= 0x0039)) return 'latin';
      if (cp >= 0x3040 && cp <= 0x309F) return 'hira';
      if (cp >= 0x30A0 && cp <= 0x30FF) return 'kata';
      if (cp >= 0x4E00 && cp <= 0x9FFF) return 'kanji';
      return 'other';
    }

    function intentFactor(start) {
      var ax = 1, ay = 1, at = 1; var el = start;
      while (el && el !== root) {
        if (el.classList && el.classList.contains('muted')) { ax *= 0.75; ay *= 0.80; at *= 0.80; }
        var di = el.getAttribute && el.getAttribute('data-intent');
        if (di === 'calm') { ax *= 0.70; ay *= 0.78; at *= 0.78; }
        if (di === 'loud') { ax *= 1.35; ay *= 1.25; at *= 1.20; }
        if (el.nodeName === 'A' || di === 'link') { ax *= 0.95; ay *= 0.95; }
        el = el.parentNode;
      }
      return { ax: ax, ay: ay, at: at };
    }

    function quant(x, step) { return Math.round(x / step) * step; }

    var graphemeSegmenter = (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function')
      ? new Intl.Segmenter('ja', { granularity: 'grapheme' }) : null;

    function toGraphemes(str) {
      if (graphemeSegmenter) {
        return Array.from(graphemeSegmenter.segment(str), function (entry) { return entry.segment; });
      }
      return fallbackGraphemes(str);
    }

    function fallbackGraphemes(str) {
      var result = [];
      var index = 0;
      while (index < str.length) {
        var cp = str.codePointAt(index);
        var cluster = String.fromCodePoint(cp);
        index += cp > 0xFFFF ? 2 : 1;
        while (index < str.length) {
          var nextCp = str.codePointAt(index);
          if (nextCp === 0x200D) {
            cluster += String.fromCodePoint(nextCp);
            index += 1;
            if (index < str.length) {
              nextCp = str.codePointAt(index);
              cluster += String.fromCodePoint(nextCp);
              index += nextCp > 0xFFFF ? 2 : 1;
              continue;
            }
            break;
          }
          if (nextCp === 0xFE0F || nextCp === 0xFE0E) {
            cluster += String.fromCodePoint(nextCp);
            index += 1;
            continue;
          }
          if (nextCp >= 0x1F3FB && nextCp <= 0x1F3FF) {
            cluster += String.fromCodePoint(nextCp);
            index += nextCp > 0xFFFF ? 2 : 1;
            continue;
          }
          break;
        }
        result.push(cluster);
      }
      return result;
    }

    var punctStr = '、。，．！？・：；（）［］｛｝「」『』—…‥,.!?;:(){}[]—–…‥';
    var stepS = 0.005, stepE = 0.002;
    var globalIndex = 0;

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i]; var text = node.nodeValue; var frag = document.createDocumentFragment();
      var chars = toGraphemes(text);
      for (var j = 0; j < chars.length; j++) {
        var ch = chars[j]; var cp = ch.codePointAt(0);
        if (cp === 32 || cp === 9 || cp === 10 || cp === 13 || cp === 160) { frag.appendChild(document.createTextNode(ch)); continue; }
        var isPunct = punctStr.indexOf(ch) !== -1; var cls = classify(cp);
        var span = document.createElement('span');
        var r1 = (Math.abs(Math.sin((j + 1) * (cp + 1) * 12.9898)) * 43758.5453) % 1;
        var r2 = (Math.abs(Math.sin((j + 1) * (cp + 1) * 78.233)) * 96485.3321) % 1;
        var F = intentFactor(node.parentNode);
        var sxMin = 0.78, sxRange = 0.56, syMin = 0.82, syRange = 0.40;
        if (isPunct) { sxMin = 0.97; sxRange = 0.06; syMin = 0.97; syRange = 0.06; }
        else if (cls === 'latin') { sxMin = 0.86; sxRange = 0.38; syMin = 0.88; syRange = 0.30; }
        else if (cls === 'hira' || cls === 'kata') { sxMin = 0.76; sxRange = 0.52; syMin = 0.84; syRange = 0.36; }
        else if (cls === 'kanji') { sxMin = 0.72; sxRange = 0.56; syMin = 0.80; syRange = 0.40; }
        sxRange *= F.ax; syRange *= F.ay;
        var sx = sxMin + sxRange * r1; var sy = syMin + syRange * r2;
        var tx = ((r1 - 0.5) * 0.026 * F.ax); var ty = ((r2 - 0.5) * 0.056 * F.at);
        sx = quant(sx, stepS); sy = quant(sy, stepS); tx = quant(tx, stepE); ty = quant(ty, stepE);
        span.style.setProperty('--sx', sx.toFixed(3));
        span.style.setProperty('--sy', sy.toFixed(3));
        span.style.setProperty('--tx', tx.toFixed(3) + 'em');
        span.style.setProperty('--ty', ty.toFixed(3) + 'em');
        span.dataset.lensX = ((r1 * 2) - 1).toFixed(3);
        span.dataset.lensY = ((r2 * 2) - 1).toFixed(3);
        var r3 = (Math.abs(Math.sin((j + 1) * (cp + 1) * 192.456)) * 83521.123) % 1;
        var r4 = (Math.abs(Math.sin((j + 1) * (cp + 1) * 421.887)) * 274922.522) % 1;
        var r5 = (Math.abs(Math.sin((j + 1) * (cp + 1) * 613.007)) * 51724.331) % 1;
        var geo = r3 > 0.68;
        span.dataset.lensMode = geo ? 'geo' : 'organic';
        var stepX, stepY, blendSeed;
        if (geo) {
          stepX = 0.22 + r3 * 0.28;
          stepY = 0.26 + r4 * 0.32;
          blendSeed = 0.58 + r4 * 0.24;
        } else {
          stepX = 0.16 + r3 * 0.10;
          stepY = 0.20 + r4 * 0.12;
          blendSeed = 0.18 + r4 * 0.20;
        }
        span.dataset.lensStepX = stepX.toFixed(3);
        span.dataset.lensStepY = stepY.toFixed(3);
        span.dataset.lensBlend = blendSeed.toFixed(3);
        span.dataset.wear = r5.toFixed(3);
        span.style.setProperty('--i', globalIndex++);
        var cn = 'c'; if (isPunct) cn += ' punct'; if (cls === 'latin') cn += ' latin'; span.className = cn;
        span.textContent = ch; frag.appendChild(span);
      }
      node.parentNode.replaceChild(frag, node);
    }

    var letters = Array.prototype.slice.call(root.querySelectorAll('.c'));

    /* ---------- 2. binary-search font fitter (<=520px) ---------- */
    if (opts.fit) {
      (function () {
        var main = opts.fit;
        var mq = window.matchMedia('(max-width: 520px)');
        var scheduled = false;
        function fit() {
          scheduled = false;
          root.style.removeProperty('--dynamic-font-size');
          if (!mq.matches) return;
          requestAnimationFrame(function () {
            var mainStyle = getComputedStyle(main);
            var paddingTop = parseFloat(mainStyle.paddingTop) || 0;
            var paddingBottom = parseFloat(mainStyle.paddingBottom) || 0;
            var available = main.clientHeight - paddingTop - paddingBottom;
            if (available <= 0) return;
            var baseSize = parseFloat(getComputedStyle(root).fontSize);
            if (!isFinite(baseSize) || baseSize <= 0) return;
            root.style.setProperty('--dynamic-font-size', baseSize + 'px');
            var rect = root.getBoundingClientRect();
            if (rect.height >= available * 0.98) return;
            var low = baseSize;
            var high = baseSize;
            var height = rect.height;
            while (height < available && high < baseSize * 3) {
              high *= 1.12;
              root.style.setProperty('--dynamic-font-size', high + 'px');
              height = root.getBoundingClientRect().height;
            }
            if (height < available) {
              root.style.setProperty('--dynamic-font-size', high.toFixed(2) + 'px');
            } else {
              var best = low;
              for (var i = 0; i < 14; i++) {
                var mid = (low + high) / 2;
                root.style.setProperty('--dynamic-font-size', mid + 'px');
                height = root.getBoundingClientRect().height;
                if (height > available) {
                  high = mid;
                } else {
                  best = mid;
                  low = mid;
                }
              }
              root.style.setProperty('--dynamic-font-size', best.toFixed(2) + 'px');
            }
            if (root.scrollWidth > main.clientWidth + 1) {
              var ratio = (main.clientWidth + 1) / root.scrollWidth;
              var adjusted = parseFloat(getComputedStyle(root).fontSize) * ratio;
              root.style.setProperty('--dynamic-font-size', adjusted.toFixed(2) + 'px');
            }
          });
        }
        function schedule() {
          if (scheduled) return;
          scheduled = true;
          requestAnimationFrame(fit);
        }
        window.addEventListener('resize', schedule, { passive: true });
        if (mq.addEventListener) {
          mq.addEventListener('change', schedule);
        } else if (mq.addListener) {
          mq.addListener(schedule);
        }
        if (document.fonts) {
          if (document.fonts.ready) {
            document.fonts.ready.then(schedule).catch(function () { });
          }
          if (document.fonts.addEventListener) {
            document.fonts.addEventListener('loadingdone', schedule);
            document.fonts.addEventListener('loadingerror', schedule);
          }
        }
        schedule();
      })();
    }

    /* ---------- 3. pointer lens ---------- */
    if (opts.lens && !reduced && letters.length) {
      (function () {
        var copy = root;
        var metrics = [];
        var metricsDirty = true;
        var raf = null;
        var activePointerId = null;
        var pointer = { x: 0, y: 0, targetX: 0, targetY: 0, strength: 0, active: false, type: 'mouse' };

        function measure() {
          var scrollX = window.scrollX || window.pageXOffset;
          var scrollY = window.scrollY || window.pageYOffset;
          metrics = letters.map(function (el) {
            var rect = el.getBoundingClientRect();
            return {
              el: el,
              absX: rect.left + rect.width / 2 + scrollX,
              absY: rect.top + rect.height / 2 + scrollY,
              seedX: parseFloat(el.dataset.lensX || 0),
              seedY: parseFloat(el.dataset.lensY || 0),
              mode: el.dataset.lensMode || 'organic',
              stepX: parseFloat(el.dataset.lensStepX || '0.28'),
              stepY: parseFloat(el.dataset.lensStepY || '0.34'),
              blend: parseFloat(el.dataset.lensBlend || '0.32'),
              active: false,
              toggled: false,
              hovered: false,
              currentIntensity: 0
            };
          });
          metricsDirty = false;
        }

        function schedule() {
          if (raf) return;
          raf = requestAnimationFrame(update);
        }

        function scheduleMeasure() {
          metricsDirty = true;
          if (pointer.active || pointer.strength > 0.001) schedule();
        }

        function flushStyles() {
          for (var i = 0; i < metrics.length; i++) {
            if (metrics[i].active) {
              metrics[i].el.style.removeProperty('--ix');
              metrics[i].el.style.removeProperty('--iy');
              metrics[i].active = false;
            }
          }
        }

        function update() {
          raf = null;
          if (!letters.length) return;
          if (metricsDirty) measure();
          pointer.x += (pointer.targetX - pointer.x) * 0.22;
          pointer.y += (pointer.targetY - pointer.y) * 0.22;
          var targetStrength = pointer.active ? 1 : 0;
          pointer.strength += (targetStrength - pointer.strength) * 0.16;

          if (pointer.strength < 0.001 && !pointer.active) {
            var anyActive = false;
            for (var i = 0; i < metrics.length; i++) {
              if (metrics[i].currentIntensity > 0.001) { anyActive = true; break; }
            }
            if (!anyActive) {
              pointer.strength = 0;
              flushStyles();
              return;
            }
          }

          var radius = (pointer.type === 'touch') ? 60 : 45;
          var radiusSq = radius * radius;
          var scrollX = window.scrollX || window.pageXOffset;
          var scrollY = window.scrollY || window.pageYOffset;

          for (var i = 0; i < metrics.length; i++) {
            var info = metrics[i];
            var dx = pointer.x - (info.absX - scrollX);
            var dy = pointer.y - (info.absY - scrollY);
            var distSq = dx * dx + dy * dy;

            if (distSq < radiusSq) {
              if (!info.hovered) {
                info.toggled = !info.toggled;
                info.hovered = true;
              }
            } else {
              info.hovered = false;
            }

            var targetIntensity = info.toggled ? 1.0 : 0.0;
            info.currentIntensity += (targetIntensity - info.currentIntensity) * 0.08;

            if (info.currentIntensity < 0.001) {
              if (info.active) {
                info.el.style.removeProperty('--ix');
                info.el.style.removeProperty('--iy');
                info.active = false;
              }
              continue;
            }

            var seedX = info.seedX;
            var seedY = info.seedY;
            var directional = info.seedX * 0.5;

            var stretchX = 1 + info.currentIntensity * (1.48 + seedX * 0.85 + directional * 0.42);
            var stretchY = 1 + info.currentIntensity * (1.82 + seedY * 1.05 - directional * 0.36);
            var stepX = isFinite(info.stepX) ? info.stepX : 0.28;
            var stepY = isFinite(info.stepY) ? info.stepY : 0.34;
            var baseBlend = isFinite(info.blend) ? info.blend : 0.32;
            if (!(stepX > 0)) stepX = 0.28;
            if (!(stepY > 0)) stepY = 0.34;
            if (info.mode === 'geo') {
              var blend = Math.min(0.94, Math.max(0.42, baseBlend + info.currentIntensity * 0.35));
              var steppedX = 1 + Math.round((stretchX - 1) / stepX) * stepX;
              var steppedY = 1 + Math.round((stretchY - 1) / stepY) * stepY;
              stretchX = stretchX * (1 - blend) + steppedX * blend;
              stretchY = stretchY * (1 - blend) + steppedY * blend;
              stretchX += (info.seedX * 0.12 + info.seedY * 0.08) * info.currentIntensity;
              stretchY += (info.seedY * 0.14 - info.seedX * 0.05) * info.currentIntensity;
            } else {
              var softBlend = Math.max(0, Math.min(0.55, baseBlend * info.currentIntensity));
              if (softBlend > 0.02) {
                var easedX = 1 + Math.round((stretchX - 1) / stepX) * stepX;
                var easedY = 1 + Math.round((stretchY - 1) / stepY) * stepY;
                stretchX = stretchX * (1 - softBlend) + easedX * softBlend;
                stretchY = stretchY * (1 - softBlend) + easedY * softBlend;
              }
            }
            if (stretchX < 1) stretchX = 1;
            else if (stretchX > 8.0) stretchX = 8.0;
            if (stretchY < 1) stretchY = 1;
            else if (stretchY > 9.0) stretchY = 9.0;

            info.el.style.setProperty('--ix', stretchX.toFixed(3));
            info.el.style.setProperty('--iy', stretchY.toFixed(3));
            info.active = true;
          }

          var keepAnimating = pointer.active || pointer.strength > 0.002;
          if (!keepAnimating) {
            for (var i = 0; i < metrics.length; i++) {
              if (metrics[i].currentIntensity > 0.001 || metrics[i].toggled) {
                keepAnimating = true;
                break;
              }
            }
          }
          if (keepAnimating) schedule();
        }

        function updatePointerFromEvent(e) {
          pointer.targetX = e.clientX;
          pointer.targetY = e.clientY;
          if (e.pointerType) pointer.type = e.pointerType;
        }

        copy.addEventListener('pointerenter', function (e) {
          updatePointerFromEvent(e);
          pointer.active = true;
          schedule();
        });

        copy.addEventListener('pointermove', function (e) {
          if (activePointerId !== null && e.pointerId !== activePointerId && e.pointerType !== 'mouse') return;
          updatePointerFromEvent(e);
          if (e.pointerType === 'touch') {
            if (e.isPrimary && typeof copy.setPointerCapture === 'function') {
              try { copy.setPointerCapture(e.pointerId); } catch (err) { }
            }
          } else if (e.pointerType === 'mouse') {
            pointer.active = true;
          }
          schedule();
        }, { passive: false });

        copy.addEventListener('pointerdown', function (e) {
          activePointerId = e.pointerId;
          updatePointerFromEvent(e);
          pointer.active = true;
          if (e.pointerType === 'touch') {
            if (typeof copy.setPointerCapture === 'function') {
              try { copy.setPointerCapture(e.pointerId); } catch (err) { }
            }
          }
          schedule();
        }, { passive: false });

        function handlePointerEnd(e) {
          if (activePointerId !== null && e.pointerId !== activePointerId && e.pointerType !== 'mouse') return;
          if (e.pointerId === activePointerId) activePointerId = null;
          if (e.pointerType === 'touch' && typeof copy.releasePointerCapture === 'function') {
            try { copy.releasePointerCapture(e.pointerId); } catch (err) { }
          }
          pointer.active = false;
          schedule();
        }

        copy.addEventListener('pointerup', handlePointerEnd);
        copy.addEventListener('pointercancel', handlePointerEnd);
        copy.addEventListener('pointerleave', function (e) {
          if (e.pointerType === 'mouse') {
            pointer.active = false;
            schedule();
          }
        });

        window.addEventListener('resize', scheduleMeasure, { passive: true });

        if (document.fonts) {
          if (document.fonts.ready) {
            document.fonts.ready.then(scheduleMeasure).catch(function () { });
          }
          if (document.fonts.addEventListener) {
            document.fonts.addEventListener('loadingdone', scheduleMeasure);
            document.fonts.addEventListener('loadingerror', scheduleMeasure);
          }
        }

        if (window.matchMedia) {
          var orientationMq = window.matchMedia('(orientation: portrait)');
          if (orientationMq && orientationMq.addEventListener) {
            orientationMq.addEventListener('change', scheduleMeasure);
          }
        }

        measure();
        setTimeout(scheduleMeasure, 400);
      })();
    }

    /* ---------- 4. scroll-velocity stretch ---------- */
    if (opts.velocity && !reduced) {
      (function () {
        var raf = null;
        var vel = 0, cur = 1, written = '1';
        var lastY = window.scrollY || 0;
        var lastT = (window.performance && performance.now()) || Date.now();
        function loop(t) {
          raf = null;
          var dt = Math.max(8, t - lastT); lastT = t;
          var y = window.scrollY || 0;
          var v = (y - lastY) / dt; lastY = y;
          vel += (v - vel) * 0.25;
          var target = 1 + Math.min(0.42, Math.abs(vel) * 0.16);
          cur += (target - cur) * 0.12;
          /* --vwarp is inherited by every glyph, so each distinct value
             re-evaluates ~900 transforms. Quantise hard: the stretch reads
             the same, and a scroll gesture writes ~10 values, not ~60. */
          var q = Math.round(cur / 0.03) * 0.03;
          if (Math.abs(cur - 1) < 0.004 && Math.abs(vel) < 0.005) {
            cur = 1;
            if (written !== '1') { root.style.setProperty('--vwarp', '1'); written = '1'; }
            return;
          }
          var s = q.toFixed(2);
          if (s !== written) { root.style.setProperty('--vwarp', s); written = s; }
          raf = requestAnimationFrame(loop);
        }
        window.addEventListener('scroll', function () {
          if (!raf) { lastT = (window.performance && performance.now()) || Date.now(); raf = requestAnimationFrame(loop); }
        }, { passive: true });
      })();
    }

    /* ---------- 5. wear / lit thresholds ---------- */
    var lastWear = -1, lastLit = -1;
    function threshold(cls, amount, last) {
      var q = Math.round(Math.max(0, Math.min(1, amount)) * 16) / 16;
      if (q === last) return last;
      for (var i = 0; i < letters.length; i++) {
        var s = parseFloat(letters[i].dataset.wear);
        if (s < q) { letters[i].classList.add(cls); }
        else { letters[i].classList.remove(cls); }
      }
      return q;
    }

    return {
      root: root,
      letters: letters,
      wear: function (amount) { lastWear = threshold('worn', amount, lastWear); },
      lit: function (amount) { lastLit = threshold('lit', amount, lastLit); }
    };
  }

  SYN.letterwarp = letterwarp;
})();
