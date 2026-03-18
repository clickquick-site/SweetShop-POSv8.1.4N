/**
 * print.js — POS DZ · وحدة الطباعة الاحترافية  v8.2.0
 * ═══════════════════════════════════════════════════════
 *  • فاتورة: 4 أنواع (عادية / دين / جزئي / تسديد)
 *  • باركود: SVG حقيقي داخل نافذة الطباعة عبر JsBarcode
 *  • @page دقيق لكل حجم ورق / ملصق
 *
 *  إصلاحات v8.2.0:
 *  ① XSS: JSON.stringify بدل دمج النصوص في JsBarcode
 *  ② AbortController بدل AbortSignal.timeout (دعم أوسع)
 *  ③ HTML → base64 قبل الإرسال (يمنع crash السيرفر)
 *  ④ حساب topMm مصحح (خطأ قسمة مزدوجة على PX_MM)
 *  ⑤ window.open: فحص محكم قبل الاستخدام
 *  ⑥ حد أقصى 200 نسخة باركود (بدل 500)
 *  ⑦ Toast "جاري الطباعة..." أثناء الانتظار
 *  ⑧ @media print للطابعات الحرارية
 *  ⑨ عرض الباركود قابل للضبط من الإعدادات
 *  ⑩ Cache للإعدادات (يقرأ IndexedDB مرة واحدة فقط)
 * ═══════════════════════════════════════════════════════
 */

;(function (window) {
  'use strict';

  /* CDN */
  var JSBC_CDN = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';

  /* احجام الملصقات بالمم */
  var LABEL_SIZES = {
    '30x20' :{w:30 ,h:20}, '40x20' :{w:40 ,h:20},
    '38x25' :{w:38 ,h:25}, '40x25' :{w:40 ,h:25},
    '40x30' :{w:40 ,h:30}, '50x30' :{w:50 ,h:30},
    '50x40' :{w:50 ,h:40}, '57x32' :{w:57 ,h:32},
    '58x20' :{w:58 ,h:20}, '58x30' :{w:58 ,h:30},
    '58x40' :{w:58 ,h:40}, '60x40' :{w:60 ,h:40},
    '70x50' :{w:70 ,h:50}, '100x50':{w:100,h:50},
  };

  /* ══════════════════════════════════════════════════════
     ⑩ Cache للإعدادات — يقرأ IndexedDB مرة واحدة لكل مفتاح
     ══════════════════════════════════════════════════════ */
  var _SETTINGS_CACHE = {};

  function cfg(key, def) {
    if (def === undefined) def = '';
    // إذا موجود في Cache أرجعه فوراً
    if (_SETTINGS_CACHE[key] !== undefined) {
      return Promise.resolve(_SETTINGS_CACHE[key]);
    }
    return window.getSetting(key).then(function(v) {
      var val = (v != null && v !== '') ? v : def;
      _SETTINGS_CACHE[key] = val;
      return val;
    }).catch(function() {
      _SETTINGS_CACHE[key] = def;
      return def;
    });
  }

  /* مسح Cache عند الحاجة (يُستدعى من settings.html بعد الحفظ) */
  function clearSettingsCache() {
    _SETTINGS_CACHE = {};
  }

  /* تنسيق رقم */
  function fmt(n, dec) {
    if (dec === undefined) dec = 2;
    return (parseFloat(n) || 0).toFixed(dec);
  }

  /* تنظيف HTML */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ③ تحويل HTML إلى base64 للإرسال الآمن */
  function _toBase64(str) {
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch(e) {
      return btoa(str);
    }
  }

  /* مساعد: جلب عنوان الخادم */
  function _serverUrl() {
    return (localStorage.getItem('posdz_server_url') || 'http://localhost:3000')
           .replace(/\/$/, '');
  }

  /* ══════════════════════════════════════════════════════
     طباعة صامتة عبر server.js
     ② AbortController بدل AbortSignal.timeout
     ③ HTML → base64 قبل الإرسال
     ⑦ Toast "جاري الطباعة..." أثناء الانتظار
     ══════════════════════════════════════════════════════ */
  async function _silentPrint(html, css, printerName, paperMm) {
    var fullHtml =
      '<!DOCTYPE html>\n<html dir="rtl" lang="ar">\n<head>\n' +
      '<meta charset="UTF-8"/>\n' +
      '<script src="' + JSBC_CDN + '"><\/script>\n' +
      '<style>' + css + '</style>\n</head>\n<body>' + html + '</body>\n</html>';

    /* ② AbortController — يعمل في كل المتصفحات */
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 30000);

    /* ⑦ Toast جاري الطباعة */
    if (window.toast) window.toast.show('🖨️ جاري الطباعة...', 'info', 30000);

    try {
      /* ③ إرسال base64 بدل النص الخام — يمنع crash السيرفر */
      var res = await fetch(_serverUrl() + '/api/print', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({
          htmlBase64  : _toBase64(fullHtml),
          printerName : printerName || '',
          paperMm     : paperMm    || 80,
        }),
        signal : controller.signal,
      });
      clearTimeout(timer);
      var data = await res.json();
      if (data.status === 'ok') {
        if (window.toast) window.toast.show('✅ تمت الطباعة على: ' + (printerName || 'الطابعة الافتراضية'), 'success');
        return true;
      }
    } catch (e) {
      clearTimeout(timer);
    }
    return false;
  }

  /* ══════════════════════════════════════════════════════
     فتح نافذة طباعة — fallback عند غياب الخادم
     ⑤ فحص محكم لـ window.open
     ══════════════════════════════════════════════════════ */
  function openWin(html, css, title) {
    var w = window.open('', '_blank',
      'width=700,height=900,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes');
    /* ⑤ فحص محكم: null أو مغلق أو محجوب */
    if (!w || w.closed || typeof w.closed === 'undefined') {
      if (window.toast) {
        window.toast.show('⚠️ فعّل النوافذ المنبثقة في المتصفح لتتمكن من الطباعة', 'warning', 5000);
      }
      return null;
    }
    w.document.write(
      '<!DOCTYPE html>\n<html dir="rtl" lang="ar">\n<head>\n' +
      '<meta charset="UTF-8"/>\n<title>' + esc(title) + '</title>\n' +
      '<script src="' + JSBC_CDN + '"><\/script>\n' +
      '<style>' + css + '</style>\n</head>\n<body>' + html + '</body>\n</html>'
    );
    w.document.close();
    return w;
  }

  /* تشغيل الطباعة — fallback */
  function doPrint(w) {
    if (!w || w.closed || typeof w.closed === 'undefined') return;
    setTimeout(function() {
      if (!w.closed) {
        w.focus();
        w.print();
        setTimeout(function() { try { w.close(); } catch(e) {} }, 800);
      }
    }, 700);
  }

  /* ══════════════════════════════════════════════════════
     1. طباعة الفاتورة
     ══════════════════════════════════════════════════════ */
  async function printInvoice(sale, items) {
    if (!sale) return;

    /* اعدادات — مستفيدة من Cache ⑩ */
    var paper      = await cfg('paperSize',    '80mm');
    var storeName  = await cfg('storeName',    '');
    var storePhone = await cfg('storePhone',   '');
    var storeAddr  = await cfg('storeAddress', '');
    var welcome    = await cfg('storeWelcome', 'شكراً لزيارتكم');
    var currency   = await cfg('currency',     'DA');
    var showName   = (await cfg('printName',    '1')) === '1';
    var showPhone  = (await cfg('printPhone',   '1')) === '1';
    var showAddr   = (await cfg('printAddress', '1')) === '1';
    var showWelc   = (await cfg('printWelcome', '1')) === '1';
    var showBC     = (await cfg('printBarcode', '1')) === '1';

    var paperMm  = paper === '58mm' ? 58 : 80;
    var printW   = paper === '58mm' ? 46 : 68;
    var fontSize = paper === '58mm' ? '9pt' : '10.5pt';

    /* تحليل البيع */
    var invNum   = sale.invoiceNumber || '';
    var kind     = sale.invoiceKind || (sale.isDebt ? 'debt' : 'normal');
    var total    = parseFloat(sale.total)    || 0;
    var discount = parseFloat(sale.discount) || 0;
    var netTotal = total - discount;
    var paid     = parseFloat(sale.paid)     || 0;
    var change   = parseFloat(sale.change)   || 0;
    var debt     = netTotal - paid;

    var kindLabel = {
      normal : 'فاتورة',
      debt   : 'فاتورة دين',
      partial: 'فاتورة تسديد جزئي',
      payment: 'فاتورة تسديد دين',
    }[kind] || 'فاتورة';

    /* تاريخ */
    var dateStr = '';
    try {
      var d = new Date(sale.date);
      dateStr = d.getFullYear() + '/' +
        String(d.getMonth()+1).padStart(2,'0') + '/' +
        String(d.getDate()).padStart(2,'0') + ' ' +
        String(d.getHours()).padStart(2,'0') + ':' +
        String(d.getMinutes()).padStart(2,'0');
    } catch(e) {}

    /* صفوف المنتجات */
    var rows = '';
    (items || []).forEach(function(it) {
      var lineTotal = it.total != null ? it.total : (it.quantity * it.unitPrice);
      rows +=
        '<tr>' +
        '<td class="cn">' + esc(it.name || '') + '</td>' +
        '<td class="cq">' + fmt(it.quantity, 0) + '</td>' +
        '<td class="cp">' + fmt(it.unitPrice) + '</td>' +
        '<td class="ct">' + fmt(lineTotal) + ' ' + esc(currency) + '</td>' +
        '</tr>';
    });

    /* المجاميع */
    var sumRows =
      '<tr class="total-row">' +
      '<td style="text-align:right;"><b>الإجمالي:</b></td>' +
      '<td style="text-align:left;direction:ltr;">' + fmt(netTotal) + ' ' + esc(currency) + '</td>' +
      '</tr>';

    if (kind === 'normal') {
      sumRows +=
        '<tr class="paid-row">' +
        '<td style="text-align:right;">المدفوع:</td>' +
        '<td style="text-align:left;direction:ltr;">' + fmt(paid) + ' ' + esc(currency) + '</td>' +
        '</tr>';
      if (change > 0) sumRows +=
        '<tr class="hdr-row">' +
        '<td style="text-align:right;">الباقي:</td>' +
        '<td style="text-align:left;direction:ltr;color:#1a6b2e;font-weight:900;">' + fmt(change) + ' ' + esc(currency) + '</td>' +
        '</tr>';
    } else if (kind === 'debt') {
      sumRows +=
        '<tr class="paid-row">' +
        '<td style="text-align:right;">المدفوع:</td>' +
        '<td style="text-align:left;direction:ltr;">0.00 ' + esc(currency) + '</td>' +
        '</tr>' +
        '<tr class="total-row" style="color:#000;font-weight:900;">' +
        '<td style="text-align:right;">الدين:</td>' +
        '<td style="text-align:left;direction:ltr;">' + fmt(netTotal) + ' ' + esc(currency) + '</td>' +
        '</tr>';
    } else if (kind === 'partial') {
      sumRows +=
        '<tr class="paid-row">' +
        '<td style="text-align:right;">المدفوع:</td>' +
        '<td style="text-align:left;direction:ltr;">' + fmt(paid) + ' ' + esc(currency) + '</td>' +
        '</tr>' +
        '<tr class="total-row" style="color:#000;font-weight:900;">' +
        '<td style="text-align:right;">الدين:</td>' +
        '<td style="text-align:left;direction:ltr;">' + fmt(debt) + ' ' + esc(currency) + '</td>' +
        '</tr>';
    } else {
      sumRows +=
        '<tr class="paid-row">' +
        '<td style="text-align:right;">المدفوع:</td>' +
        '<td style="text-align:left;direction:ltr;">' + fmt(paid) + ' ' + esc(currency) + '</td>' +
        '</tr>';
    }

    /* ① باركود الفاتورة — JSON.stringify بدل دمج النصوص */
    var bcSection = showBC && invNum ?
      '<div style="text-align:center;margin:4px 0 2px;">' +
      '<svg id="invBC" style="display:block;margin:0 auto;max-width:100%;"></svg>' +
      '<div class="barcode-num">' + esc(invNum) + '</div>' +
      '</div>' +
      '<script>' +
      'window.addEventListener("load",function(){' +
      'try{JsBarcode("#invBC",' + JSON.stringify(invNum) + ',{' +
      'format:"CODE128",width:1.4,height:36,displayValue:false,margin:0,' +
      'background:"#fff",lineColor:"#000"' +
      '});}catch(e){}});' +
      '<\/script>' : '';

    /* رأس الفاتورة */
    var custRow = (sale.customerName || sale.customerPhone) ?
      '<tr class="hdr-row">' +
      '<td style="text-align:right;">الزبون:</td>' +
      '<td style="text-align:left;direction:ltr;">' + esc(sale.customerName || sale.customerPhone || '') + '</td>' +
      '</tr>' : '';

    var storeBlock = '';
    if (showName && storeName)  storeBlock += '<div class="store-name">' + esc(storeName) + '</div>';
    if (showPhone && storePhone) storeBlock += '<div style="text-align:center;font-weight:900;margin:1px 0;">' + esc(storePhone) + '</div>';
    if (showAddr  && storeAddr)  storeBlock += '<div style="text-align:center;font-size:0.88em;margin:1px 0;">' + esc(storeAddr) + '</div>';
    var hr2after = storeBlock ? '<hr class="d2">' : '';

    var html =
      '<div class="content">' +
      '<table class="t2"><colgroup><col><col></colgroup><tbody>' +
      '<tr class="hdr-row"><td colspan="2" style="text-align:right;padding-bottom:1px;">' + esc(kindLabel) + ': ' + esc(invNum) + '</td></tr>' +
      '<tr class="hdr-row"><td colspan="2" style="text-align:right;direction:ltr;padding-top:0;">' + esc(dateStr) + '</td></tr>' +
      '<tr class="hdr-row"><td style="text-align:right;">البائع:</td><td style="text-align:left;direction:ltr;">' + esc(sale.sellerName || 'ADMIN') + '</td></tr>' +
      custRow +
      '</tbody></table>' +
      '<hr class="d2">' +
      storeBlock + hr2after +
      '<table class="ti"><colgroup>' +
      '<col class="cn"><col class="cq"><col class="cp"><col class="ct">' +
      '</colgroup><thead><tr>' +
      '<th class="cn">المنتج</th><th class="cq">ك</th>' +
      '<th class="cp">السعر</th><th class="ct">المجموع</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      '<hr class="d1">' +
      '<table class="t2"><colgroup><col><col></colgroup><tbody>' + sumRows + '</tbody></table>' +
      '<hr class="d2">' +
      (showWelc && welcome ? '<div class="welcome">' + esc(welcome) + '</div>' : '') +
      bcSection +
      '<hr class="db">' +
      '<div style="height:8mm;"></div>' +
      '</div>';

    /* ⑧ CSS + @media print للطابعات الحرارية */
    var css =
      '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}' +
      '@page{size:' + paperMm + 'mm auto;margin:2mm;}' +
      'html,body{width:100%;max-width:' + (paperMm-4) + 'mm;background:#fff;margin:0;padding:0;' +
      'font-family:"Courier New",Courier,monospace;' +
      'font-size:' + fontSize + ';font-weight:800;direction:rtl;color:#000;}' +
      '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}' +
      '.content{width:' + printW + 'mm;margin:0 auto;}' +
      '.hdr-row td{font-size:' + fontSize + ';font-weight:900;padding:2px 0;}' +
      '.store-name{font-size:1.35em;font-weight:900;letter-spacing:.5px;margin:4px 0;text-align:center;}' +
      '.welcome{font-size:1.2em;font-weight:900;margin:4px 0 2px;text-align:center;}' +
      '.barcode-num{font-family:"Courier New",monospace;font-size:.82em;letter-spacing:3px;margin:2px 0;font-weight:700;text-align:center;}' +
      '.t2{width:100%;border-collapse:collapse;table-layout:fixed;}' +
      '.t2 col:nth-child(1){width:42%;}.t2 col:nth-child(2){width:58%;}' +
      '.t2 td{padding:2px 0;vertical-align:baseline;overflow:hidden;word-break:break-all;}' +
      '.ti{width:100%;border-collapse:collapse;table-layout:fixed;' +
      'font-size:' + fontSize + ';font-weight:800;margin:3px 0;}' +
      '.ti thead tr{border-bottom:2px solid #000;}' +
      '.ti th{font-size:.92em;font-weight:900;padding:3px 1px;text-align:right;}' +
      '.ti td{padding:3px 1px;font-weight:800;vertical-align:top;overflow:hidden;word-break:break-word;}' +
      '.ti tbody tr+tr{border-top:1px dashed #aaa;}' +
      '.cn{width:34%;text-align:right;}' +
      '.cq{width:9%;text-align:center;}' +
      '.cp{width:24%;text-align:right;white-space:nowrap;}' +
      '.ct{width:33%;text-align:right;direction:ltr;font-weight:900;}' +
      '.total-row td{font-size:1.3em;font-weight:900;padding:3px 0;}' +
      '.paid-row td{font-size:1.15em;font-weight:800;padding:2px 0;}' +
      'hr{border:none;margin:4px 0;}' +
      '.d1{border-top:1px dashed #555;}' +
      '.d2{border-top:2px solid #000;}' +
      '.db{border-top:1px dashed #999;margin-top:5px;}';

    var printerName = await cfg('printerInvoice', '');
    var silent = await _silentPrint(html, css, printerName, paperMm);
    if (!silent) {
      var w = openWin(html, css, kindLabel + ' ' + invNum);
      doPrint(w);
    }
  }

  /* ══════════════════════════════════════════════════════
     2. طباعة الباركود
     ══════════════════════════════════════════════════════ */
  async function printBarcode(product, copies) {
    if (!product) return;
    if (!copies) copies = 1;

    var rawSize  = (await cfg('barcodeSize',     '40x30')).replace(/[×*]/g,'x');
    var bcType   =  await cfg('barcodeType',      'CODE128');
    var fontSize = parseInt(await cfg('barcodeFontSize','12')) || 12;
    var showStore= (await cfg('barcodeShowStore', '0')) === '1';
    var showName = (await cfg('barcodeShowName',  '1')) === '1';
    var showPrice= (await cfg('barcodeShowPrice', '1')) === '1';
    var storeName=  await cfg('storeName', '');
    var currency =  await cfg('currency',  'DA');
    /* ⑨ عرض الباركود قابل للضبط من الإعدادات */
    var bcWidth  = parseFloat(await cfg('barcodeWidth', '1.4')) || 1.4;

    var sz = LABEL_SIZES[rawSize] || {w:40,h:30};
    /* ⑥ حد أقصى 200 نسخة بدل 500 */
    var n  = Math.max(1, Math.min(200, parseInt(copies) || 1));

    var code     = String(product.barcode || '');
    var name     = String(product.name    || '');
    var rawPrice = product.sellPrice != null ? product.sellPrice : (product.price != null ? product.price : '');
    var priceStr = rawPrice !== '' ? fmt(rawPrice) + ' ' + esc(currency) : '';

    /* خطوط */
    var FSstore = Math.max(5, fontSize - 1);
    var FSname  = Math.max(5, fontSize);
    var FScode  = Math.max(5, fontSize - 2);
    var FSprice = Math.max(5, fontSize + 1);
    var PX_MM   = 3.7795; /* 1mm = 3.7795 px على 96dpi */

    /* ④ ارتفاع الباركود SVG — حساب مصحح (لا قسمة مزدوجة) */
    var topMm  = (showStore && storeName ? (FSstore + 1.5) / PX_MM : 0)
               + (showName  && name      ? (FSname  + 1.5) / PX_MM : 0);
    var botMm  = (FScode + 2)  / PX_MM
               + (showPrice && priceStr ? (FSprice + 2) / PX_MM : 0);
    var bcH_mm = Math.max(4, sz.h - topMm - botMm - 2);
    var bcH_px = Math.round(bcH_mm * PX_MM);

    /* خيارات JsBarcode — ⑨ استخدام bcWidth */
    var formats = {
      CODE128:{format:'CODE128', width: bcWidth},
      CODE39 :{format:'CODE39',  width: Math.max(1.0, bcWidth - 0.2)},
      EAN13  :{format:'EAN13',   width: bcWidth},
      EAN8   :{format:'EAN8',    width: bcWidth},
      UPCA   :{format:'UPC',     width: bcWidth},
      ITF14  :{format:'ITF14',   width: bcWidth},
      MSI    :{format:'MSI',     width: bcWidth},
    };
    var bcOpt = formats[bcType] || formats.CODE128;

    /* بناء الملصقات */
    var labels = '';
    for (var i = 0; i < n; i++) {
      var sid = 'bc_' + i;
      labels +=
        '<div class="label">' +
        (showStore && storeName ? '<div class="lstore">' + esc(storeName) + '</div>' : '') +
        (showName  && name      ? '<div class="lname">'  + esc(name)      + '</div>' : '') +
        '<div class="lbc"><svg id="' + sid + '" style="display:block;margin:0 auto;"></svg></div>' +
        '<div class="lcode">' + esc(code) + '</div>' +
        (showPrice && priceStr  ? '<div class="lprice">' + esc(priceStr) + '</div>' : '') +
        '</div>';
    }

    /* ① JsBarcode — JSON.stringify بدل دمج النصوص */
    var initJS =
      '<script>' +
      'window.addEventListener("load",function(){' +
      'var opt={format:' + JSON.stringify(bcOpt.format) + ',width:' + bcOpt.width + ',' +
      'height:' + bcH_px + ',displayValue:false,margin:0,' +
      'background:"#fff",lineColor:"#000"};' +
      'var code=' + JSON.stringify(code) + ';' +
      'for(var i=0;i<' + n + ';i++){' +
      'try{JsBarcode("#bc_"+i,code,opt);}catch(e){}' +
      '}});' +
      '<\/script>';

    /* ⑧ CSS + @media print للطابعات الحرارية */
    var css =
      '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}' +
      '@page{size:' + sz.w + 'mm ' + sz.h + 'mm;margin:0;}' +
      'html,body{width:' + sz.w + 'mm;background:#fff;' +
      'font-family:"Tahoma","Arial",sans-serif;color:#000;}' +
      '@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}' +
      '.label{width:' + sz.w + 'mm;height:' + sz.h + 'mm;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
      'padding:.8mm 1mm;overflow:hidden;' +
      'page-break-after:always;break-after:page;}' +
      '.label:last-child{page-break-after:avoid;break-after:avoid;}' +
      '.lstore{font-size:' + FSstore + 'px;font-weight:900;text-align:center;' +
      'line-height:1.1;white-space:nowrap;overflow:hidden;max-width:100%;margin-bottom:.4mm;}' +
      '.lname{font-size:' + FSname + 'px;font-weight:900;text-align:center;' +
      'line-height:1.1;white-space:nowrap;overflow:hidden;max-width:100%;margin-bottom:.4mm;}' +
      '.lbc{flex:1;display:flex;align-items:center;justify-content:center;' +
      'width:100%;overflow:hidden;padding:0 1mm;}' +
      '.lbc svg{max-width:100%;height:auto;}' +
      '.lcode{font-size:' + FScode + 'px;font-family:"Courier New",monospace;' +
      'text-align:center;letter-spacing:1px;margin-top:.3mm;}' +
      '.lprice{font-size:' + FSprice + 'px;font-weight:900;text-align:center;margin-top:.3mm;}';

    var printerName = await cfg('printerBarcode', '');
    var silent = await _silentPrint(labels + initJS, css, printerName, sz.w);
    if (!silent) {
      var w = openWin(labels + initJS, css, 'باركود: ' + name);
      doPrint(w);
    }
  }


  /* ══════════════════════════════════════════════════════
     3. اختيار الطابعة
     ══════════════════════════════════════════════════════ */
  async function choosePrinter(type) {
    var key    = type === 'invoice' ? 'printerInvoice' : 'printerBarcode';
    var cardId = type === 'invoice' ? 'invoicePrinterCard'  : 'barcodePrinterCard';
    var nameId = type === 'invoice' ? 'invoicePrinterName'  : 'barcodePrinterName';
    var current = await cfg(key, '');
    var name = prompt(
      type === 'invoice'
        ? 'اسم طابعة الفواتير (كما يظهر في Windows):'
        : 'اسم طابعة الباركود (كما يظهر في Windows):',
      current
    );
    if (name == null) return;
    var trimmed = name.trim();
    try {
      await window.setSetting(key, trimmed);
      /* مسح Cache ليقرأ القيمة الجديدة */
      delete _SETTINGS_CACHE[key];
    } catch(e) {}
    var el = document.getElementById(nameId);
    var cd = document.getElementById(cardId);
    if (el) el.textContent = trimmed || 'الطابعة الافتراضية';
    if (cd) cd.classList.toggle('selected', !!trimmed);
    if (trimmed) window.toast && window.toast.show('تم حفظ الطابعة: ' + trimmed, 'success');
  }


  /* ══════════════════════════════════════════════════════
     تصدير
     ══════════════════════════════════════════════════════ */
  window.printInvoice       = printInvoice;
  window.clearPrintCache    = clearSettingsCache;
  window.POSDZ_PRINT        = {
    invoice           : printInvoice,
    barcode           : printBarcode,
    choosePrinter     : choosePrinter,
    LABEL_SIZES       : LABEL_SIZES,
    clearSettingsCache: clearSettingsCache,
  };

})(window);
