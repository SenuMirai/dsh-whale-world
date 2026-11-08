/**
 * dsh-world — 浏览器半侧：设置里的「世界控制台」。
 * 模块 id 必须等于 bundle 行名 dsh-world；数据来自宿主半侧的 /dsh-world/console/* 路由。
 * 读取是 GET；会改变东西的（开始、停止、人设、世界提示词、额度、记忆轮数）是带 x-dsh-world 头的 JSON POST。
 */
window.__ModuleLoader__.load({
  id: 'dsh-world',
  factory: (require) => {
    var react = require('react')
    var h = react.createElement
    var useState = react.useState
    var useEffect = react.useEffect
    var useRef = react.useRef

    function settle(r) {
      return r.json().then(function (body) { return { body: body } }, function () { return null }).then(function (parsed) {
        var body = parsed && parsed.body
        if (!r.ok) { var err = new Error((body && body.error) || ('HTTP ' + r.status)); err.status = r.status; throw err }
        if (!parsed) { var bad = new Error('回复不是 JSON'); bad.notJson = true; throw bad }
        return body
      })
    }
    function api(path) { return fetch('/dsh-world/console/' + path, { cache: 'no-store' }).then(settle) }
    function post(path, body) {
      return fetch('/dsh-world/console/' + path, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-dsh-world': '1' }, body: JSON.stringify(body || {}) }).then(settle)
    }
    /** QQ 那几扇门在自己的前缀下（/dsh-world/qq/*），不和 console 混在一起。 */
    function qqGet(path) { return fetch('/dsh-world/qq/' + path, { cache: 'no-store' }).then(settle) }
    function qqPost(path, body) {
      return fetch('/dsh-world/qq/' + path, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-dsh-world': '1' }, body: JSON.stringify(body || {}) }).then(settle)
    }
    /** 快照，或 null 表示控制台不在（404、不是 JSON 的页面、没有 life 字段的回复）。 */
    function loadSnapshot() {
      return api('snapshot').then(function (s) {
        return s && typeof s === 'object' && typeof s.life === 'object' ? s : null
      }, function (e) { if (e && (e.status === 404 || e.notJson)) return null; throw e })
    }
    function clock(iso, zone) {
      try { return new Date(iso).toLocaleTimeString('zh-CN', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }) } catch (e) { return String(iso) }
    }
    function local(iso, zone) {
      if (!iso) return '—'
      try { return new Date(iso).toLocaleString('zh-CN', { timeZone: zone, hourCycle: 'h23', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch (e) { return iso }
    }
    function remaining(iso) {
      var ms = Date.parse(iso) - Date.now()
      if (!(ms > 0)) return '马上'
      var m = Math.round(ms / 60000), d = Math.floor(m / 1440), hr = Math.floor(m % 1440 / 60), mi = m % 60
      return (d ? d + ' 天 ' : '') + (hr ? hr + ' 小时 ' : '') + mi + ' 分'
    }
    function list(value) { return Array.isArray(value) ? value : [] }
    var sourceLabel = { first: '新家', return: '回来', plan: '闹钟', fallback: '早上兜底', review: '回顾' }
    var statusLabel = { running: '正在做事', idle: '空闲', cold: '休息中' }

    var LAYERS = [
      { key: '名字', hint: '她叫什么。家的标题、记忆里她的署名都用它。', rows: 1 },
      { key: '她是谁', hint: '一句话：她是什么样的存在。', rows: 2 },
      { key: '性格', hint: '她的脾气、偏好和小习惯。', rows: 4 },
      { key: '说话方式', hint: '口吻、句子长短、会不会用表情。', rows: 3 },
      { key: '愿景', hint: '你希望她成为什么样子。', rows: 4 },
      { key: '补充', hint: '其他想让她知道的：底线、默契、约定。', rows: 3 },
    ]
    /** 和宿主半侧 renderPersona 一样拼：她读到的就是这段。 */
    function renderPersona(p) {
      var opening = (p['名字'] ? '我是' + p['名字'] + '。' : '') + (p['她是谁'] || '')
      var parts = [opening]
      ;['性格', '说话方式', '愿景'].forEach(function (k) { if (p[k]) parts.push('# ' + k + '\n' + p[k]) })
      parts.push(p['补充'] || '')
      return parts.filter(Boolean).join('\n\n')
    }

    var CSS = [
      '.dw{--ink:var(--dsw-alias-label-primary,#2a2620);--soft:var(--dsw-alias-label-tertiary,#8b8475);--gold:#c49a52;',
      '--line:color-mix(in srgb,currentColor 13%,transparent);--paper:color-mix(in srgb,currentColor 3.5%,transparent);',
      '--glow:color-mix(in srgb,var(--gold) 22%,transparent);--warn:#c4553a;--serif:"Noto Serif SC","Source Han Serif SC","Songti SC","STSong","SimSun",serif;',
      'max-width:780px;display:flex;flex-direction:column;gap:18px;font-size:13px;line-height:1.65;color:var(--ink)}',
      '.dw *{box-sizing:border-box}',
      '.dw-head{position:relative;display:flex;align-items:flex-end;gap:16px;padding:18px 20px 16px;border:1px solid var(--line);border-radius:14px;',
      'background:radial-gradient(120% 140% at 100% 0%,var(--glow),transparent 55%),var(--paper);overflow:hidden}',
      '.dw-head:after{content:"";position:absolute;left:20px;right:20px;bottom:0;height:1px;background:linear-gradient(90deg,transparent,var(--gold),transparent);opacity:.55}',
      '.dw-title{flex:1;min-width:0}.dw-title small{display:block;letter-spacing:.24em;font-size:10px;text-transform:uppercase;color:var(--soft)}',
      '.dw-title h2{margin:2px 0 0;font:600 24px/1.25 var(--serif);letter-spacing:.04em}',
      '.dw-state{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--soft);margin-top:6px}',
      '.dw-dot{width:8px;height:8px;border-radius:50%;background:var(--soft);opacity:.6}',
      '.dw-on .dw-dot{background:var(--gold);opacity:1;box-shadow:0 0 0 0 var(--glow);animation:dw-breathe 2.6s ease-in-out infinite}',
      '@keyframes dw-breathe{0%,100%{box-shadow:0 0 0 0 var(--glow)}50%{box-shadow:0 0 0 7px transparent}}',
      '.dw-power{font:600 13px var(--serif);letter-spacing:.2em;padding:9px 20px 9px 22px;border-radius:999px;cursor:pointer;transition:transform .15s,box-shadow .2s,background .2s;',
      'border:1px solid var(--gold);background:var(--gold);color:#fffaf0;box-shadow:0 6px 18px -8px var(--gold)}',
      '.dw-power:hover{transform:translateY(-1px);box-shadow:0 10px 22px -8px var(--gold)}',
      '.dw-power.stop{background:transparent;color:var(--ink);border-color:var(--line);box-shadow:none}.dw-power.stop:hover{border-color:var(--warn);color:var(--warn)}',
      '.dw-power:disabled{opacity:.5;cursor:default;transform:none}',
      '.dw-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);padding:0 6px}',
      '.dw-tab{position:relative;font:500 13px var(--serif);letter-spacing:.12em;padding:8px 14px 10px;background:none;border:0;color:var(--soft);cursor:pointer}',
      '.dw-tab:after{content:"";position:absolute;left:50%;right:50%;bottom:-1px;height:2px;background:var(--gold);transition:left .25s,right .25s}',
      '.dw-tab.on{color:var(--ink)}.dw-tab.on:after{left:12px;right:12px}',
      '.dw-pane{display:flex;flex-direction:column;gap:14px}',
      '.dw-traces .dw-setting{display:block}',
      '.dw-traces .dw-setting>span{display:block;margin:4px 0;white-space:pre-wrap}',
      '.dw-traces .dw-setting .dw-meter{margin:5px 0}',
      '.dw-traces .dw-setting .dw-btn{margin-right:6px}',
      '.dw-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}',
      '.dw-card{min-width:0;border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--paper);animation:dw-rise .45s both}',
      '@keyframes dw-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',
      '.dw-card h4{margin:0 0 10px;font:600 13px var(--serif);letter-spacing:.14em;display:flex;align-items:center;gap:8px}',
      '.dw-card h4:before{content:"";width:14px;height:1px;background:var(--gold)}',
      '.dw-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 14px}.dw-kv dt{color:var(--soft);white-space:nowrap}.dw-kv dd{margin:0;min-width:0;overflow-wrap:anywhere}',
      '.dw-big{font:600 20px/1.2 var(--serif)}.dw-muted{color:var(--soft)}.dw-bad{color:var(--warn)}.dw-ok{color:var(--gold)}',
      '.dw-quote{border-left:2px solid var(--gold);padding:2px 0 2px 10px;margin:8px 0 0;font-family:var(--serif)}',
      '.dw-meter{height:4px;border-radius:4px;background:var(--line);overflow:hidden;margin:8px 0 4px}.dw-meter i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),color-mix(in srgb,var(--gold) 55%,#fff))}',
      '.dw-trail{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:4px}.dw-trail span{display:inline-flex;align-items:center;gap:6px}.dw-trail span:before{content:"";width:5px;height:5px;border-radius:50%;background:var(--gold)}',
      '.dw-welcome{text-align:center;padding:30px 20px}.dw-welcome h3{font:600 20px var(--serif);margin:0 0 8px;letter-spacing:.06em}',
      '.dw-steps{display:inline-flex;flex-direction:column;gap:6px;text-align:left;margin-top:12px;counter-reset:s}',
      '.dw-steps li{list-style:none;counter-increment:s;display:flex;gap:10px}.dw-steps li:before{content:counter(s);font:600 12px var(--serif);color:var(--gold);border:1px solid var(--gold);border-radius:50%;width:20px;height:20px;display:inline-grid;place-items:center;flex:none}',
      '.dw-layer{display:grid;grid-template-columns:96px 1fr;gap:4px 16px;padding:14px 0;border-bottom:1px dashed var(--line)}',
      '.dw-layer:last-child{border-bottom:0}.dw-layer label{font:600 14px var(--serif);letter-spacing:.1em;padding-top:6px}',
      '.dw-layer small{grid-column:2;color:var(--soft);font-size:11.5px}',
      '.dw textarea,.dw input[type=text]{width:100%;font:inherit;color:inherit;background:color-mix(in srgb,currentColor 2%,transparent);border:1px solid var(--line);border-radius:8px;padding:8px 10px;resize:vertical;transition:border-color .2s,box-shadow .2s}',
      '.dw textarea:focus,.dw input[type=text]:focus{outline:none;border-color:var(--gold);box-shadow:0 0 0 3px var(--glow)}',
      '.dw input.dw-name{font:600 18px var(--serif);letter-spacing:.06em}',
      '.dw-code{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:12px;line-height:1.6;min-height:340px}',
      '.dw-bar{position:sticky;bottom:0;display:flex;align-items:center;gap:10px;padding:10px 0 2px;background:linear-gradient(transparent,var(--dsw-alias-background-primary,transparent) 40%)}',
      '.dw-btn{flex-shrink:0;white-space:nowrap;font:inherit;cursor:pointer;border:1px solid var(--line);background:transparent;color:inherit;border-radius:8px;padding:6px 14px;transition:border-color .2s,background .2s}',
      '.dw-btn:hover{border-color:var(--gold)}.dw-btn.primary{background:var(--gold);border-color:var(--gold);color:#fffaf0}.dw-btn:disabled{opacity:.45;cursor:default}',
      '.dw-preview{white-space:pre-wrap;font-family:var(--serif);font-size:12.5px;margin:0;max-height:260px;overflow:auto}',
      '.dw-chip{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--line);color:var(--soft)}',
      '.dw table{width:100%;border-collapse:collapse}.dw td{padding:3px 6px;vertical-align:top;border-bottom:1px solid color-mix(in srgb,currentColor 6%,transparent)}',
      '.dw-activity{table-layout:fixed}.dw-activity td{overflow:hidden;overflow-wrap:anywhere}.dw-activity td:first-child{white-space:nowrap}',
      '.dw-clamp{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:12px}',
      '.dw-setting{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;align-items:center}.dw-setting input[type=text]{flex:1 1 120px;max-width:200px;min-width:0}',
      '.dw-setting select{flex:1 1 140px;max-width:100%;min-width:0}',
      '.dw pre.dw-diary{white-space:pre-wrap;margin:10px 0 0;font-family:var(--serif)}',
      '.dw select{font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:6px;padding:2px 6px}',
      '@media (prefers-reduced-motion:reduce){.dw *{animation:none!important;transition:none!important}}',
    ].join('')
    function ensureStyle() {
      if (document.getElementById('dsh-world-console-style')) return
      var tag = document.createElement('style'); tag.id = 'dsh-world-console-style'; tag.textContent = CSS; document.head.appendChild(tag)
    }

    function Card(props) {
      return h('section', { className: 'dw-card', style: { animationDelay: (props.delay || 0) + 'ms' } }, props.title ? h('h4', null, props.title) : null, props.children)
    }
    function KV(rows) {
      return h('dl', { className: 'dw-kv' }, rows.filter(Boolean).map(function (row, i) { return [h('dt', { key: 'k' + i }, row[0]), h('dd', { key: 'v' + i }, row[1])] }))
    }

function activityNote(r) {
      var tool = String(r.tool || '')
      var summary = String(r.summary || '')
      var name = summary.split(/[\\/]/u).pop() || summary
      // 行为主体不是她的时候，先说清楚是谁干的 —— 不然活动页会把
      // 「抖音那个 AI 自己刷的」读成「她刷的」。
      if (r.actor === 'douyin-plugin') return '抖音入口那个 AI 自己看了：' + summary
      if (r.actor === 'self') return '她自己刷的：' + summary
      if (r.actor === 'unattributed') return summary
      if (/screenshot|computer|click|type|keypress/i.test(tool)) return '在电脑上操作了一下：' + (summary || tool)
      if (/read/i.test(tool)) return '读了 ' + name
      if (/write|edit|append/i.test(tool)) return '写了/改了 ' + name
      if (/search|web/i.test(tool)) return '上网查了：' + summary
      if (/bili|video|comment|danmaku/i.test(tool)) return '在 B 站看了/说了：' + summary
      if (r.outside) return '在房间外用了 ' + tool + '：' + summary
      return '用了 ' + tool + '：' + summary
    }

    function Activity(props) {
      var days = props.days, zone = props.zone
      var dayState = useState(days[0] || ''), day = dayState[0], setDay = dayState[1]
      var outsideState = useState(false), outside = outsideState[0], setOutside = outsideState[1]
      var rowsState = useState([]), rows = rowsState[0], setRows = rowsState[1]
      var errState = useState(null), err = errState[0], setErr = errState[1]
      useEffect(function () {
        if (!day) return
        var alive = true
        api('activity?day=' + encodeURIComponent(day) + (outside ? '&outside=1' : '')).then(
          function (r) { if (alive) { setRows(r); setErr(null) } },
          function (e) { if (alive) { setRows([]); setErr(String(e.message || e)) } })
        return function () { alive = false }
      }, [day, outside, props.tick])
      var inner =
        days.length === 0 ? h('div', { className: 'dw-muted' }, '还没有活动记录') : h('div', null,
          h('select', { value: day, onChange: function (e) { setDay(e.target.value) } }, days.map(function (d) { return h('option', { key: d, value: d }, d) })),
          ' ', h('label', { className: 'dw-muted' }, h('input', { type: 'checkbox', checked: outside, onChange: function (e) { setOutside(e.target.checked) } }), ' 只看房间外'),
          err ? h('div', { className: 'dw-bad' }, '读取失败：' + err) : null,
          h('table', { className: 'dw-activity' },
            h('colgroup', null, h('col', { style: { width: 48 } }), h('col', { style: { width: '22%' } }), h('col'), h('col', { style: { width: 40 } }), h('col', { style: { width: 64 } })),
            h('tbody', null, rows.map(function (r) {
            return h('tr', { key: r.callId + r.time }, h('td', { className: 'dw-muted' }, clock(r.time, zone)), h('td', null, r.tool), h('td', { title: activityNote(r) }, h('div', { className: 'dw-clamp' }, activityNote(r))), h('td', { className: 'dw-bad' }, r.status === 'error' ? '失败' : ''), h('td', { className: r.outside ? 'dw-bad' : 'dw-muted' }, (r.gapBefore ? '（此前有缺口）' : '') + (r.outside ? '房间外' : '')))
          }))))
      if (props.bare === true) return inner
      return h(Card, { title: '活动记录' }, inner)
    }

    /** 可折叠的一块：默认收起，点标题展开。 */
    function Fold(props) {
      var st = useState(props.defaultOpen === true), open = st[0], setOpen = st[1]
      return h('div', { style: { padding: '10px 12px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', marginBottom: '12px', background: 'var(--dsw-alias-bg-l1)' } },
        h('button', {
          style: { display: 'flex', alignItems: 'center', gap: '8px', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', textAlign: 'left' },
          onClick: function () { setOpen(!open) }
        },
          h('span', { style: { width: '12px', opacity: 0.7 } }, open ? '▾' : '▸'),
          h('span', { style: { fontWeight: 600 } }, props.title),
          props.hint ? h('span', { className: 'dw-muted', style: { fontSize: '12px' } }, props.hint) : null),
        open ? h('div', { style: { marginTop: '10px' } }, props.children) : null)
    }

    /** 什么算「娱乐」：浏览器、看视频、逛社区、动电脑。 */
    var ENTERTAIN = /browser|chrome|edge|playwright|puppeteer|computer|screenshot|bili|youtube|xiaohongshu|reddit|zhihu|weibo|douyin|video|music|game|visit|open_url|web_fetch|web_search|browse/i

    /**
     * 最近娱乐：她自己在网上逛了什么、看了什么。
     * 数据来自活动记录，只留浏览和电脑操作。
     */
    function Entertainment(props) {
      var days = (props.days || []).slice(0, 5)
      var rowsState = useState([]), rows = rowsState[0], setRows = rowsState[1]
      var errState = useState(null), err = errState[0], setErr = errState[1]
      var busyState = useState(true), busy = busyState[0], setBusy = busyState[1]
      useEffect(function () {
        if (days.length === 0) { setBusy(false); return }
        var alive = true
        var collected = []
        function next(i) {
          if (!alive) return
          if (i >= days.length) { setRows(collected); setBusy(false); return }
          api('activity?day=' + encodeURIComponent(days[i])).then(
            function (list) {
              var arr = Array.isArray(list) ? list : []
              for (var k = 0; k < arr.length; k += 1) {
                if (ENTERTAIN.test(String(arr[k].tool || ''))) collected.push({ day: days[i], row: arr[k] })
              }
              next(i + 1)
            },
            function (e) { if (alive) { setErr(String((e && e.message) || e)); setBusy(false) } })
        }
        next(0)
        return function () { alive = false }
      }, [days.join(','), props.tick])
      return h(Card, { title: '最近娱乐', delay: 60 },
        h('div', { className: 'dw-muted' }, '她自己在网上逛了什么。只记浏览和电脑操作，不含工作文件和命令。'),
        err ? h('div', { className: 'dw-bad' }, '读取失败：' + err) : null,
        busy ? h('div', { className: 'dw-muted' }, '读取中…') : null,
        !busy && rows.length === 0 ? h('div', { className: 'dw-muted' }, '这几天还没有逛过') : null,
        rows.length > 0 ? h('div', null, rows.slice(-40).reverse().map(function (item, i) {
          var r = item.row
          return h('div', { key: (r.callId || i) + String(r.time), style: { padding: '6px 0', borderBottom: '1px solid var(--dsw-alias-border-l2)' } },
            h('div', { className: 'dw-muted' }, item.day + ' ' + clock(r.time, props.zone) + ' · ' + r.tool),
            h('div', { style: { marginTop: '2px' } }, activityNote(r)))
        })) : null)
    }

        function Diary(props) {
      var first = props.dates[0] || ''
      var openState = useState(first), open = openState[0], setOpen = openState[1]
      var textState = useState(''), text = textState[0], setText = textState[1]
      var errState = useState(null), err = errState[0], setErr = errState[1]
      var filterState = useState(''), filter = filterState[0], setFilter = filterState[1]
      var favState = useState([])
      var favs = Array.isArray(favState[0]) ? favState[0] : [], setFavs = favState[1]
      useEffect(function () { try { var saved = JSON.parse(localStorage.getItem('dsh-world-diary-favorites') || '[]'); if (Array.isArray(saved)) setFavs(saved) } catch (e) {} }, [])
      var wanted = useRef(null)
      function show(date) {
        wanted.current = date; setOpen(date); setText(''); setErr(null)
        api('diary?date=' + encodeURIComponent(date)).then(
          function (b) { if (wanted.current === date) setText(String(b.text || '')) },
          function (e) { if (wanted.current === date) setErr(String(e.message || e)) })
      }
      function toggleFav(date) {
        var next = favs.indexOf(date) >= 0 ? favs.filter(function (d) { return d !== date }) : favs.concat(date)
        setFavs(next)
        try { localStorage.setItem('dsh-world-diary-favorites', JSON.stringify(next)) } catch (e) {}
      }
      var dates = props.dates.filter(function (d) { return filter === '' || d === filter })
      return h(Card, { title: '日记' },
        props.dates.length === 0 ? h('div', { className: 'dw-muted' }, '还没有日记') : h('div', null,
          h('div', { className: 'dw-setting' },
            h('input', { type: 'date', value: filter, onChange: function (e) { setFilter(e.target.value); setOpen(e.target.value); if (e.target.value) show(e.target.value) } }),
            h('button', { className: 'dw-btn', onClick: function () { setFilter(''); if (first) show(first) } }, '全部日期'),
            h('span', { className: 'dw-muted' }, '已收藏 ' + dates.filter(function (d) { return favs.indexOf(d) >= 0 }).length + ' 天')),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 } }, dates.map(function (d) {
            return h('span', { key: d, style: { display: 'inline-flex', gap: 2 } },
              h('button', { className: 'dw-btn' + (open === d ? ' primary' : ''), onClick: function () { show(d) } }, d),
              h('button', { className: 'dw-btn', title: '收藏', onClick: function () { toggleFav(d) } }, favs.indexOf(d) >= 0 ? '★' : '☆'))
          })),
          err ? h('div', { className: 'dw-bad' }, '读取失败：' + err) : null,
          open && !err ? h('pre', { className: 'dw-diary' }, text) : null))
    }

    /**
     * 她写的信（2026-11-08 从「鱼与人」搬回世界）。
     *
     * 为什么单独一页：主人原话是「以后世界插件设置中单独一个页面专门呈现她写的信」。
     * 信的正文不在快照里（可能攒了几百封），点哪一封才去取哪一封。
     */
    function Letters() {
      var listState = useState([]), list = listState[0], setList = listState[1]
      var dirState = useState(''), dir = dirState[0], setDir = dirState[1]
      var openState = useState(''), open = openState[0], setOpen = openState[1]
      var textState = useState(''), text = textState[0], setText = textState[1]
      var errState = useState(null), err = errState[0], setErr = errState[1]
      var wanted = useRef('')
      function show(name) {
        wanted.current = name; setOpen(name); setText(''); setErr(null)
        api('letter?name=' + encodeURIComponent(name)).then(
          function (b) { if (wanted.current === name) setText(String(b.text || '')) },
          function (e) { if (wanted.current === name) setErr(String(e.message || e)) })
      }
      useEffect(function () {
        var alive = true
        api('letters').then(function (b) {
          if (!alive) return
          var items = Array.isArray(b.letters) ? b.letters : []
          setList(items); setDir(String(b.dir || ''))
          if (items.length) show(items[0].name)
        }, function (e) { if (alive) setErr(String(e.message || e)) })
        return function () { alive = false }
      }, [])
      return h(Card, { title: '她写的信' },
        h('div', { className: 'dw-muted' }, dir ? '落在 ' + dir : '信放在世界的 letters/ 目录里（还没写就是空的）'),
        list.length === 0
          ? h('div', { className: 'dw-muted' }, '她还没写过信。这不是失败 —— 有话想说的时候才写。')
          : h('div', null,
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 } }, list.map(function (item) {
              var clock = String(item.at || '').slice(11, 16)
              return h('button', {
                key: item.name,
                className: 'dw-btn' + (open === item.name ? ' primary' : ''),
                title: item.preview || '',
                onClick: function () { show(item.name) }
              }, clock && clock !== '00:00' ? item.date + ' ' + clock : item.date)
            })),
            err ? h('div', { className: 'dw-bad' }, '读取失败：' + err) : null,
            open && !err ? h('pre', { className: 'dw-diary' }, text) : null))
    }

    /** 她的相册：keep_photo 留下的照片，和她当时写的话。照片点开才去取字节。 */
    /**
     * 人设：一整段原文，一个大文本框。
     *
     * 2026-10-28 改：原来是「六层结构」，每层一张卡。
     * 但 QQ 插件同步进来的是整段纯文本角色卡，两种格式对不上：
     * 这边按层解析读到的是空，谁在这页点保存又会把整段角色卡改写成空壳。
     * 现在统一成纯文本 —— 文件里存什么，这里就编辑什么，两边不会再互相覆盖。
     */
    function PersonaEditor(props) {
      var state = useState(null), text = state[0], setText = state[1]
      var savedState = useState(null), saved = savedState[0], setSaved = savedState[1]
      var msgState = useState(''), msg = msgState[0], setMsg = msgState[1]
      var busyState = useState(false), busy = busyState[0], setBusy = busyState[1]
      /** 后端还是旧版（没重启）时为 false：那时候保存必定失败，不如直接说清楚。 */
      var readyState = useState(true), ready = readyState[0], setReady = readyState[1]
      useEffect(function () {
        api('prompts').then(function (b) {
          // 后端新版会带 personaText；没有就是还没重启。
          if (typeof b.personaText !== 'string') {
            setReady(false)
            setText(''); setSaved('')
            return
          }
          setReady(true)
          setText(b.personaText); setSaved(b.personaText)
        }, function (e) { setMsg('读取失败：' + (e.message || e)) })
      }, [])
      if (text === null) return h('div', { className: 'dw-muted' }, msg || '读取中…')
      // 后端没重启：不给编辑，避免点保存时把角色卡改坏或收到一个看不懂的报错。
      if (!ready) {
        return h('div', { className: 'dw-pane' },
          h(Card, { title: '她是谁' },
            h('div', { className: 'dw-muted' },
              '这一版人设改成「整段纯文本」了，但运行中的宿主还是旧代码，现在还改不了。'),
            h('small', null, '重启一次 DSH 之后，这里会变成一个大的文本框，编辑的就是 persona.md 原文。'),
            h('small', null, '重启前请不要在别处改人设 —— QQ 插件同步的和这里期望的格式不同，容易互相覆盖。')))
      }
      var dirty = text !== saved
      function save() {
        setBusy(true)
        post('persona', { text: text }).then(function () {
          setSaved(text); setMsg('已保存。下次开始对话或压缩之后，她就照这份来。'); if (props.onSaved) props.onSaved()
        }, function (e) { setMsg('保存失败：' + (e.message || e)) }).then(function () { setBusy(false) })
      }
      var chars = text.length
      return h('div', { className: 'dw-pane' },
        h(Card, { title: '她是谁' },
          h('div', { className: 'dw-layer' },
            h('label', { htmlFor: 'dw-persona-text' }, '人设原文'),
            h('small', null, '整段写。她读到什么，就取决于你这里写什么。QQ 插件里的角色卡会同步进这一份，两处编辑的是同一段文字。'),
            h('textarea', {
              id: 'dw-persona-text',
              rows: 22,
              // .dw-layer 是「96px + 1fr」两列网格；不加这个，textarea 会被塞进
              // 96px 那一列，变成一根窄条。跨满整行才是它该有的样子。
              style: { gridColumn: '1 / -1', width: '100%', boxSizing: 'border-box' },
              value: text,
              placeholder: '比如：我是助手，住在这个家……',
              onChange: function (e) { setText(e.target.value); setMsg('') },
            }),
            h('small', null, chars > 0 ? '共 ' + chars + ' 字' : '还没写。空着的时候，她用宿主默认的人设。'))),
        h('div', { className: 'dw-bar' },
          h('button', { className: 'dw-btn primary', disabled: !dirty || busy, onClick: save }, busy ? '保存中…' : '保存人设'),
          h('span', { className: msg.indexOf('失败') >= 0 ? 'dw-bad' : 'dw-muted' }, msg || (dirty ? '有改动还没保存' : ''))))
    }
    /** 世界提示词模板：自己的一份，或插件自带的。 */
    function PromptEditor() {
      var state = useState(null), prompt = state[0], setPrompt = state[1]
      var textState = useState(''), text = textState[0], setText = textState[1]
      var msgState = useState(''), msg = msgState[0], setMsg = msgState[1]
      function load() { api('prompts').then(function (b) { setPrompt(b.worldPrompt); setText(b.worldPrompt.text) }, function (e) { setMsg('读取失败：' + (e.message || e)) }) }
      useEffect(load, [])
      if (!prompt) return h('div', { className: 'dw-muted' }, msg || '读取中…')
      function save(value, done) {
        post('world-prompt', { text: value }).then(function () { setMsg(done); load() }, function (e) { setMsg('保存失败：' + (e.message || e)) })
      }
      return h('div', { className: 'dw-pane' },
        h(Card, { title: '世界提示词' },
          h('div', { style: { marginBottom: 8 } }, h('span', { className: 'dw-chip' }, prompt.custom ? '你自己的一份' : '插件自带'), ' ',
            h('span', { className: 'dw-muted' }, '可用 {{name}} {{partner}} {{homeTitle}} {{roomDir}} {{diaryDir}} {{selfFile}} {{self}} 和 {{#home}}…{{/home}} 等，见 README')),
          h('textarea', { className: 'dw-code', value: text, onChange: function (e) { setText(e.target.value); setMsg('') } })),
        h('div', { className: 'dw-bar' },
          h('button', { className: 'dw-btn primary', disabled: text === prompt.text, onClick: function () { save(text, '已保存。下次开始对话或压缩之后生效。') } }, '保存'),
          prompt.custom ? h('button', { className: 'dw-btn', onClick: function () { if (window.confirm('删掉你自己的这份，换回插件自带的模板？')) save('', '已换回插件自带的模板。') } }, '恢复默认') : null,
          h('span', { className: msg.indexOf('失败') >= 0 ? 'dw-bad' : 'dw-muted' }, msg)))
    }

    /** 今天家里花了多少，和每天的额度（留空不限）。 */
    function Budget(props) {
      var budget = props.budget || {}, daily = budget.daily, today = budget.today
      var spent = today ? today.yuan : 0
      var draftState = useState(daily == null ? '' : String(daily)), draft = draftState[0], setDraft = draftState[1]
      var msgState = useState(''), msg = msgState[0], setMsg = msgState[1]
      function save() {
        var text = String(draft).trim(), value = text === '' ? null : Number(text)
        if (value !== null && !(value >= 0)) { setMsg('请填一个不小于 0 的数，或留空表示不限'); return }
        post('budget', { daily: value }).then(function () { setMsg(value === null ? '已改为不限' : '已保存'); if (props.onSaved) props.onSaved() }, function (e) { setMsg('保存失败：' + (e.message || e)) })
      }
      var over = daily != null && spent >= daily
      return h(Card, { title: '今日花费', delay: 240 },
        h('div', null, h('span', { className: 'dw-big' + (over ? ' dw-bad' : '') }, '¥' + spent.toFixed(2)), h('span', { className: 'dw-muted' }, daily == null ? ' · 不限额' : ' / ¥' + Number(daily).toFixed(2) + ' 每天')),
        daily != null ? h('div', { className: 'dw-meter' }, h('i', { style: { width: Math.min(100, daily > 0 ? Math.round(spent / daily * 100) : 100) + '%' } })) : null,
        h('div', { className: 'dw-muted', style: { marginTop: 4 } }, '只算家里；按 DeepSeek 官方价与峰谷时段估算。超过后提醒她一次。'),
        h('div', { className: 'dw-setting' },
          h('input', { type: 'text', inputMode: 'decimal', placeholder: '每天额度（元），留空不限', value: draft, onChange: function (e) { setDraft(e.target.value); setMsg('') } }),
          h('button', { className: 'dw-btn', onClick: save }, '保存')),
        msg ? h('div', { className: msg.indexOf('失败') >= 0 || msg.indexOf('请填') >= 0 ? 'dw-bad' : 'dw-muted' }, msg) : null)
    }
    /** 记忆块带最近几轮：默认 200，下次开始对话或压缩之后生效。 */
    function Memory(props) {
      var mem = props.mem, window_ = mem && mem.windowTurns || 200
      var activeScope = mem && mem.archiveScope || 'workspace'
      var scopeNames = { home: '仅家会话', workspace: '家所在工作区' }
      var scopeState = useState(mem && mem.selectedArchiveScope || activeScope), scope = scopeState[0], setScope = scopeState[1]
      var draftState = useState(String(window_)), draft = draftState[0], setDraft = draftState[1]
      var msgState = useState(''), msg = msgState[0], setMsg = msgState[1]
      function save() {
        var text = String(draft).trim(), value = text === '' ? null : Number(text)
        if (value !== null && !(Number.isInteger(value) && value >= 1)) { setMsg('请填一个不小于 1 的整数，留空恢复默认 200'); return }
        post('memory', { turns: value }).then(function () { setMsg('已保存。下次开始对话或压缩之后生效。'); if (value === null) setDraft('200'); if (props.onSaved) props.onSaved() }, function (e) { setMsg('保存失败：' + (e.message || e)) })
      }
      function saveScope() {
        post('archive-scope', { scope: scope }).then(function (result) {
          setMsg(result.restartRequired ? '已保存。请重启 DSH，启动后按新范围和消息时间重建记忆块。' : '归档范围已保存。')
          if (props.onSaved) props.onSaved()
        }, function (e) { setMsg('保存失败：' + (e.message || e)) })
      }
      return h(Card, { title: '短期衔接（不是记忆总量）', delay: 180 }, mem ? [
        h('div', { key: 'm' }, h('span', { className: 'dw-big' }, mem.turns), h('span', { className: 'dw-muted' }, ' / ' + window_ + ' 轮')),
        h('div', { key: 'b', className: 'dw-meter' }, h('i', { style: { width: Math.min(100, Math.round((mem.turns || 0) / window_ * 100)) + '%' } })),
        h('div', { key: 'd', className: 'dw-muted' }, '约 ' + mem.approxTokens + ' token · 归档 ' + mem.records + ' 条 · 来自 ' + mem.sessions + ' 个会话'),
        h('div', { key: 'active', className: 'dw-muted' }, '当前归档：' + scopeNames[activeScope]),
        h('div', { key: 'scope', className: 'dw-setting' },
          h('select', { value: scope, 'aria-label': '记忆归档范围', onChange: function (e) { setScope(e.target.value); setMsg('') } },
            h('option', { value: 'home' }, '仅家会话'), h('option', { value: 'workspace' }, '家所在工作区')),
          h('button', { className: 'dw-btn', onClick: saveScope }, '保存范围')),
        mem.restartRequired ? h('div', { key: 'restart', className: 'dw-muted', role: 'status' }, '范围已修改，请重启 DSH。重启前继续使用当前范围。') : null,
        h('div', { key: 's', className: 'dw-setting' },
          h('input', { type: 'text', inputMode: 'numeric', 'aria-label': '记忆带最近几轮', placeholder: '最近几轮，留空为 200', value: draft, onChange: function (e) { setDraft(e.target.value); setMsg('') } }),
          h('button', { className: 'dw-btn', onClick: save }, '保存')),
        msg ? h('div', { key: 'x', className: msg.indexOf('失败') >= 0 || msg.indexOf('请填') >= 0 ? 'dw-bad' : 'dw-muted' }, msg) : null,
      ] : h('div', { className: 'dw-muted' }, '—'))
    }
    /** 微信：适配器每约 2 秒来问一次，最近一次来问的时间就是连接状态；两个读取参数在它下次来问时同步。 */
    function Wechat(props) {
      var w = props.wechat, zone = props.zone
      var contextState = useState(String(w.contextMessages)), context = contextState[0], setContext = contextState[1]
      var bufferState = useState(String(w.bufferSeconds)), buffer = bufferState[0], setBuffer = bufferState[1]
      var msgState = useState(''), msg = msgState[0], setMsg = msgState[1]
      var age = w.lastContactAt ? Date.now() - new Date(w.lastContactAt).getTime() : null
      var contacted = age != null && age < 30000, offline = contacted && w.account === 'offline'
      var ad = w.adapter
      var blocked = ad && ad.needsHuman
      var stateText = blocked ? '● 有消息待核对，适配器已停' : !contacted ? (ad && ad.running ? '● 适配器启动中' : ad && ad.error ? '● 等待适配器文件' : w.lastContactAt ? '● 适配器已断开' : '● 等待适配器') : offline ? '● 微信离线，等待重新登录' : '● 已连接'
      var adMsgState = useState(''), adMsg = adMsgState[0], setAdMsg = adMsgState[1]
      function restartAdapter() {
        setAdMsg('正在重启…')
        post('wechat-adapter', {}).then(function () { setAdMsg('已重启'); if (props.onSaved) props.onSaved() }, function (e) { setAdMsg('重启失败：' + (e.message || e)) })
      }
      function save() {
        var c = String(context).trim() === '' ? null : Number(context), b = String(buffer).trim() === '' ? null : Number(buffer)
        if (c !== null && !(Number.isInteger(c) && c >= 1 && c <= 20)) { setMsg('请填 1–20 的整数，留空恢复默认 8'); return }
        if (b !== null && !(b >= 0 && b <= 30)) { setMsg('请填 0–30 秒，留空恢复默认 3'); return }
        post('wechat', { contextMessages: c, bufferSeconds: b }).then(function () {
          setMsg('已保存。适配器下次轮询时同步，当前这一批沿用原值。')
          if (c === null) setContext('8'); if (b === null) setBuffer('3')
          if (props.onSaved) props.onSaved()
        }, function (e) { setMsg('保存失败：' + (e.message || e)) })
      }
      return h(Card, { title: '微信', delay: 300 },
        h('div', null, h('span', { className: 'dw-big ' + (contacted && !offline ? 'dw-ok' : 'dw-bad') }, stateText)),
        KV([
          ['最近联系', w.lastContactAt ? local(w.lastContactAt, zone) : '—'],
          ['绑定账号', w.accountId || '—'],
          ad ? ['适配器', ad.running ? '由插件管理 · 运行中' + (ad.restarts ? '（已重启 ' + ad.restarts + ' 次）' : '') : '由插件管理 · 已退出' + (ad.error ? '：' + ad.error : ad.lastExit ? '（' + ad.lastExit + '），等待重启' : '')] : null,
          ['聊天', w.accountId ? w.chats + ' 个' : '—'],
          ['待发送', String(w.pending)],
          ['待核对', h('span', { className: w.uncertain ? 'dw-bad' : '' }, String(w.uncertain))],
        ]),
        w.uncertain ? h('div', { className: 'dw-muted' }, '发送结果不明的消息不会自动重发，请在微信里核对后用适配器 acknowledge 确认。') : null,
        blocked ? h('div', { className: 'dw-bad' }, '上次有消息处理到一半、结果不明。先在微信里核对是否真的发出，再用适配器的 acknowledge 确认（见适配器 README），然后点下面的重启。') : null,
        ad ? h('div', { className: 'dw-bar' }, h('button', { className: 'dw-btn', onClick: restartAdapter }, '重启适配器'), adMsg ? h('span', { className: adMsg.indexOf('失败') >= 0 ? 'dw-bad' : 'dw-muted' }, adMsg) : null) : null,
        h('div', { className: 'dw-setting' },
          h('input', { type: 'text', inputMode: 'numeric', 'aria-label': '群聊读取上文条数', placeholder: '上文条数，默认 8', value: context, onChange: function (e) { setContext(e.target.value); setMsg('') } }),
          h('input', { type: 'text', inputMode: 'decimal', 'aria-label': '图片缓冲秒数', placeholder: '缓冲秒数，默认 3', value: buffer, onChange: function (e) { setBuffer(e.target.value); setMsg('') } }),
          h('button', { className: 'dw-btn', onClick: save }, '保存')),
        h('div', { className: 'dw-muted' }, '上文按消息条数算（群聊被 @ 时带上之前几条）；缓冲是私聊图片等待后续图片或文字的秒数。与共享记忆的 200 轮无关。'),
        msg ? h('div', { className: msg.indexOf('失败') >= 0 || msg.indexOf('请填') >= 0 ? 'dw-bad' : 'dw-muted' }, msg) : null)
    }
    /** QQ：外面的 qq-bridge 进程，在这里看状态、拉起、停掉；入口绑到哪个会话也在这里看。 */
    // 巡检的状态词和颜色。键是 src/ecosystem/qq/supervisor.ts 的 SupervisorState。
    var SUP_TONES = {
      healthy: ['dw-ok', '正常'],
      degraded: ['dw-bad', '探测失败'],
      recovering: ['dw-bad', '正在拉起'],
      starting: ['dw-muted', '启动中'],
      stopped: ['dw-muted', '已停（不会自动拉起）'],
      failed: ['dw-bad', '放弃自动恢复'],
    }
    function supTone(state) { return (SUP_TONES[state] || ['dw-muted', '未知'])[0] }
    function supLabel(state) { return (SUP_TONES[state] || ['dw-muted', state || '未知'])[1] }
    function Qq(props) {
      var qq = props.qq || {}
      var busyState = useState(false), busy = busyState[0], setBusy = busyState[1]
      var msgState = useState(''), msg = msgState[0], setMsg = msgState[1]
      var rows = list(qq.sessions)
      function run(path) {
        setBusy(true); setMsg('')
        qqPost(path).then(function () {
          setMsg('')
          if (props.onSaved) props.onSaved()
        }, function (e) { setMsg('失败：' + ((e && e.message) || e)) }).then(function () { setBusy(false) })
      }
      // 两个控制台都带 X-Frame-Options: DENY，塞不进 iframe，所以交给系统浏览器开。
      // 地址和令牌由宿主半侧现给（/dsh-world/qq/console），所以打开就是登录态。
      function openDoor(kind) {
        var label = kind === 'snowluma' ? 'SnowLuma' : 'QQ Bridge'
        setBusy(true); setMsg('')
        qqGet('console').then(function (res) {
          var door = res && res[kind]
          // 还差密码的门也带着地址，先认这件事，别把登录页当成品打开。
          if (door && door.needs === 'password') { if (props.onNeedPassword) props.onNeedPassword(kind); return null }
          if (door && door.url) {
            return qqPost('open', { kind: kind }).then(function (r) {
              setMsg(r && r.opened ? '已在浏览器打开 ' + label + ' 控制台' : '失败：' + ((r && r.error) || '打不开'))
            })
          }
          setMsg('失败：' + ((door && door.error) || '宿主没给地址'))
          return null
        }, function (e) { setMsg('失败：' + ((e && e.message) || e)) }).then(function () { setBusy(false) })
      }
      var faults = list(qq.faults)
      var sup = qq.supervisor || null
      return h(Card, { title: 'QQ', delay: 240 }, [
        h('div', { key: 's' }, h('span', { className: qq.running ? 'dw-ok' : 'dw-muted' }, qq.running ? '● 桥在跑' : '● 没在跑'),
          h('span', { className: 'dw-muted' }, ' · 端口 ' + qq.port + (qq.mode ? ' · ' + qq.mode : ''))),
        qq.running ? h('div', { key: 'c', className: 'dw-muted' },
          'DSH ' + (qq.dsh ? '已连上' : '没连上') + ' · QQ ' + (qq.connected ? (qq.accountOnline ? '在线' : '已连接、号没上线') : '没连上') + (qq.lastPacketAgoMs === null || qq.lastPacketAgoMs === undefined ? '' : ' · 上次收包 ' + Math.round(qq.lastPacketAgoMs / 1000) + ' 秒前')) : null,
        sup ? h('div', { key: 'p', className: 'dw-muted' },
          h('span', { className: supTone(sup.state) }, '● 巡检 ' + supLabel(sup.state)),
          ' · 连续失败 ' + (sup.consecutiveFailures || 0) + ' 次 · 10 分钟内已拉起 ' + (sup.restartsInWindow || 0) + ' 次',
          sup.backoffMs ? ' · 退避 ' + Math.round(sup.backoffMs / 1000) + ' 秒' : '',
          sup.dshReady === false ? ' · DSH 那边没就绪' : '') : null,
        sup && sup.lastError ? h('div', { key: 'pe', className: 'dw-bad' }, '● ' + sup.lastError) : null,
        h('div', { key: 'e', className: 'dw-trail' }, rows.length ? rows.map(function (r, i) {
          return h('span', { key: i }, r.key + ' → ' + String(r.sessionId || '').replace(/^session-/, '').slice(0, 8))
        }) : h('span', { className: 'dw-muted' }, '还没有入口绑到会话')),
        h('div', { key: 'k', className: 'dw-setting' },
          h('button', { className: 'dw-btn', disabled: busy, onClick: function () { openDoor('snowluma') } }, '打开 SnowLuma 控制台'),
          h('button', { className: 'dw-btn', disabled: busy, onClick: function () { openDoor('qq') } }, '打开 QQ Bridge 控制台')),
        h('div', { key: 'b', className: 'dw-setting' },
          h('button', { className: 'dw-btn', disabled: busy, onClick: function () { run('start') } }, busy ? '……' : '拉起桥'),
          h('button', { className: 'dw-btn', disabled: busy, onClick: function () { run('stop') } }, '重启'),
          // 真停：桥记下 intent=stopped 且不拉接力进程，巡检看到 stopped 就不会再拉它起来。
          h('button', { className: 'dw-btn', disabled: busy, onClick: function () { run('halt') } }, '停桥（不再自动拉起）'),
          h('button', { className: 'dw-btn', disabled: busy, onClick: function () { if (props.onSaved) props.onSaved() } }, '刷新')),
        msg ? h('div', { key: 'x', className: msg.indexOf('失败') >= 0 ? 'dw-bad' : 'dw-muted' }, msg) : null,
        faults.length ? faults.map(function (f, i) { return h('div', { key: 'f' + i, className: 'dw-bad' }, '● ' + f) }) : null,
      ])
    }
    /**
     * 第一次打开 SnowLuma 控制台时，得先用面板密码换一个会话令牌：那令牌只活在那边的进程内存里，重启就没了。
     * 密码不在浏览器里存着，填完就交给宿主半侧，换到令牌后由宿主把系统浏览器拉起来。
     * 两个控制台都发 X-Frame-Options: DENY，塞不进 iframe，所以只能这样开。
     */
    function Panel(props) {
      var passState = useState(''), pass = passState[0], setPass = passState[1]
      var busyState = useState(false), busy = busyState[0], setBusy = busyState[1]
      var errState = useState(''), err = errState[0], setErr = errState[1]
      function signIn() {
        if (!pass) { setErr('先填密码'); return }
        setBusy(true); setErr('')
        qqPost('panel-password', { password: pass }).then(function (body) {
          var next = body && body.snowluma
          if (!next || !next.url) { setErr((next && next.error) || '登录失败'); return null }
          setPass('')
          return qqPost('open', { kind: 'snowluma' }).then(function (r) {
            if (r && r.opened) { if (props.onClose) props.onClose() } else setErr((r && r.error) || '打不开浏览器')
          })
        }, function (e) { setErr(String((e && e.message) || e)) }).then(function () { setBusy(false) })
      }
      return h('div', { style: { position: 'fixed', left: 0, top: 0, width: '100%', height: '100%', zIndex: 60, background: 'rgba(10,14,20,.66)', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
        h('div', { style: { width: 480, maxWidth: '92%', background: '#141b25', border: '1px solid rgba(255,255,255,.1)', borderRadius: 12, padding: 20, boxSizing: 'border-box' } },
          h('h3', { style: { margin: '0 0 8px', color: '#e8edf4' } }, '第一次打开 SnowLuma 控制台'),
          h('div', { className: 'dw-muted', style: { marginBottom: 16, lineHeight: 1.6 } }, '它只认密码、没有账号名这回事；会话令牌只存在进程内存里，过期就没了，所以要用面板密码换一次。密码留在你这台机器上，不会回传浏览器。'),
          h('label', { style: { display: 'block', marginBottom: 16, color: '#c7d2de' } }, '密码 ',
            h('input', { type: 'password', value: pass, onChange: function (e) { setPass(e.target.value) }, onKeyDown: function (e) { if (e.key === 'Enter') signIn() }, style: { width: 220 } })),
          err ? h('div', { className: 'dw-bad', style: { marginBottom: 12 } }, '● ' + err) : null,
          h('button', { className: 'dw-btn', disabled: busy, onClick: signIn }, busy ? '……' : '登录并打开'),
          h('button', { className: 'dw-btn', style: { marginLeft: 10 }, onClick: function () { if (props.onClose) props.onClose() } }, '取消')))
    }
    /** 接入：微信和 QQ 各一个开关。开着才注册微信的发送工具、路由和适配器 / 才由插件管理 QQ 桥；关掉就撤掉，立即生效，状态记在 world.json。 */
    function Modules(props) {
      var m = props.modules
      var msgState = useState(''), msg = msgState[0], setMsg = msgState[1]
      var busyState = useState(''), busy = busyState[0], setBusy = busyState[1]
      function flip(name, value) {
        var body = {}; body[name] = value
        setBusy(name); setMsg('')
        post('modules', body).then(function () { setBusy(''); if (props.onSaved) props.onSaved() }, function (e) { setBusy(''); setMsg('切换失败：' + (e.message || e)) })
      }
      function row(name, label, info, onText, offText) {
        var state = !info.available ? '未配置' : !info.enabled ? '已关闭' : info.running ? '运行中' : props.running ? '启动中' : '已开启，世界启动后生效'
        return h('div', { key: name, className: 'dw-setting' },
          h('span', null, h('b', null, label), h('span', { className: 'dw-muted' }, ' · ' + state)),
          h('button', { className: 'dw-btn', disabled: !info.available || busy === name, onClick: function () { flip(name, !info.enabled) } }, info.enabled ? '关闭' : '开启'),
          h('div', { className: 'dw-muted', style: { flexBasis: '100%' } }, info.enabled ? onText : offText))
      }
      return h(Card, { title: '接入', delay: 270 },
        row('wechat', '微信', m.wechat, '已注册 wechat_chats、wechat_send、wechat_delivery，并随之启动适配器。关闭会撤掉它们并停掉适配器。', '工具未注册，适配器已停。开启后立即注册，无需重启。'),
        row('qq', 'QQ', m.qq, '由插件管理 qq-bridge：巡检、会话绑定、控制台 QQ 卡。关闭只停止管理，不会停掉已在运行的桥。', '插件不管理 QQ 桥，QQ 卡隐藏。开启后立即恢复。'),
        msg ? h('div', { className: 'dw-bad' }, msg) : null)
    }
    function Overview(props) {
      var snap = props.snap, zone = snap.timeZone, life = snap.life, alarm = life && life.alarm, mem = snap.memory
      var health = list(snap.health), wakes = life ? list(life.recentWakes) : []
      var welcome = !snap.running && !life
      return h('div', { className: 'dw-pane' },
        welcome ? h(Card, null, h('div', { className: 'dw-welcome' },
          h('h3', null, '她还没有住进来'),
          h('div', { className: 'dw-muted' }, '先写下她是谁，再按右上角的「开始」。'),
          h('ol', { className: 'dw-steps' },
            h('li', null, '在「人设」里写她的名字、性格和你对她的愿景'),
            h('li', null, '需要的话，在「世界提示词」里写你想对她说的话'),
            h('li', null, '按「开始」：插件建好她的房间和家，叫醒她')))) : null,
        life ? h('div', { className: 'dw-grid' },
          h(Card, { title: '此刻', delay: 0 },
            h('div', { className: 'dw-big' }, statusLabel[life.status] || life.status),
            alarm ? h('div', { style: { marginTop: 8 } }, h('span', { className: 'dw-muted' }, (sourceLabel[alarm.source] || '闹钟') + ' · '), local(alarm.at, zone), h('span', { className: 'dw-muted' }, '（还有 ' + remaining(alarm.at) + '）')) : h('div', { className: 'dw-muted' }, '没有待定的闹钟'),
            alarm && alarm.note ? h('blockquote', { className: 'dw-quote' }, alarm.note) : null),
          h(Card, { title: '家', delay: 60 }, KV([
            ['会话', String(life.homeSessionId || '还没有家').replace(/^session-/, '').slice(0, 8)],
            ['下次回顾', life.review ? local(life.review.at, zone) : '—'],
            ['最近', wakes.length ? h('div', { className: 'dw-trail' }, wakes.map(function (w, i) { return h('span', { key: i }, local(w.deliveredAt, zone) + ' ' + (sourceLabel[w.source] || w.source) + (w.lateMs >= 120000 ? ' · 晚 ' + Math.round(w.lateMs / 60000) + ' 分' : '')) })) : '—'],
          ]), h(HomeSwitch, { current: life.homeSessionId, onSaved: props.refresh }))) : null,
        h('div', { className: 'dw-grid' },
          h(Card, { title: '健康', delay: 120 }, health.length ? health.map(function (f, i) { return h('div', { key: i, className: 'dw-bad' }, '● ' + f) }) : h('div', { className: 'dw-ok' }, '● 一切正常')),
          h(Memory, { mem: mem, onSaved: props.refresh }),
          h(ContextBudget, { ctx: snap.context }),
          h(Budget, { budget: snap.budget, onSaved: props.refresh }),
          snap.modules && (snap.modules.wechat.available || snap.modules.qq.available) ? h(Modules, { modules: snap.modules, running: snap.running, onSaved: props.refresh }) : null,
          snap.wechat ? h(Wechat, { wechat: snap.wechat, zone: zone, onSaved: props.refresh }) : null,
          snap.qq ? h(Qq, { qq: snap.qq, onSaved: props.refresh, onNeedPassword: props.onNeedPassword }) : null))
    }

    /**
     * 上下文预算：每一轮请求到底背了多少东西。
     *
     * 为什么需要这一块：主人一直以为「记忆 60 轮」就是她的记忆总量。
     * 其实那只是短期衔接，角色卡、世界提示词、工具表、记忆痕迹都在别处，
     * 加起来比历史大一倍。不摊开看，调参永远调错地方。
     */
    function ContextBudget(props) {
      var ctx = props.ctx
      if (!ctx || !list(ctx.blocks).length) return null
      var blocks = list(ctx.blocks)
      var total = ctx.total || 0
      var window_ = 1000000 // 参考窗口：主流 1M 上下文
      var pct = Math.min(100, Math.round((total / window_) * 1000) / 10)
      var maxAbs = Math.max.apply(null, blocks.map(function (b) { return b.tokens || 0 }))
      function fmt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') }
      // 实况判断
      var advice = []
      var biggest = blocks.slice().sort(function (a, b) { return (b.tokens || 0) - (a.tokens || 0) })[0]
      if (biggest && biggest.key === 'tools') advice.push('工具表是最大的一块（' + fmt(biggest.tokens) + ' token）。她不用的时候不该常驻——查一下按需加载有没有生效。')
      if (biggest && biggest.key === 'history') advice.push('历史是最大的一块（' + fmt(biggest.tokens) + ' token）。想更快就把「短期衔接轮数」调小，记忆本身不受影响。')
      if (pct > 40) advice.push('已用掉 ' + pct + '% 的 1M 窗口。超过八成会开始自动压缩，压缩会丢细节。')
      else if (pct > 15) advice.push('占 1M 窗口的 ' + pct + '%，还很宽裕。这个量主要影响首字速度，不影响能不能记住。')
      else advice.push('只占 1M 窗口的 ' + pct + '%，非常轻。慢的话大概率是模型本身，不是上下文。')
      return h(Card, { title: '上下文预算', delay: 160 },
        h('div', { className: 'dw-muted', style: { marginBottom: 8 } }, '这是她每次开口前要读完的东西。数字越小，回得越快。'),
        blocks.map(function (b) {
          var w = maxAbs > 0 ? Math.max(2, Math.round(((b.tokens || 0) / maxAbs) * 100)) : 2
          return h('div', { key: b.key, style: { margin: '7px 0' } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 } },
              h('span', null, b.label),
              h('span', { className: 'dw-muted' }, fmt(b.tokens || 0) + ' token')),
            h('div', { style: { height: 6, borderRadius: 3, background: 'color-mix(in srgb,currentColor 9%,transparent)', overflow: 'hidden' } },
              h('div', { style: { width: w + '%', height: '100%', background: 'var(--gold)', opacity: 0.65 } })),
            b.hint ? h('div', { className: 'dw-muted', style: { fontSize: 11.5, marginTop: 2 } }, b.hint) : null)
        }),
        h('div', { style: { marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--line)' } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', fontWeight: 600 } },
            h('span', null, '合计'),
            h('span', null, fmt(total) + ' token · 约占 1M 窗口 ' + pct + '%'))),
        h('div', { className: 'dw-muted', style: { marginTop: 10, fontSize: 12, lineHeight: 1.7 } },
          '受这些设置影响：',
          h('br'),
          '· 角色卡 —— QQ 插件里的人设卡（改一次两边同步）',
          h('br'),
          '· 世界提示词 —— 设置里的「世界提示词」，写多少算多少',
          h('br'),
          '· 记忆痕迹注入 —— 由记忆条数与相关性决定，不是全部记忆，只是挑出来的几条',
          h('br'),
          '· 对话历史 —— 只由「短期衔接轮数」控制，和长期记忆无关',
          h('br'),
          '· 工具表 —— 插件注册了多少工具；按需加载能把它压到很小',
          h('br'),
          '自动压缩：快撞上模型窗口时，宿主会把最早的一段对话压成摘要，细节会丢。所以别把窗口喂满。'),
        advice.length ? h('div', { style: { marginTop: 10, fontSize: 12, lineHeight: 1.7 } },
          advice.map(function (a, i) { return h('div', { key: i, className: 'dw-muted' }, '· ' + a) })) : null)
    }

    /** 换家：把她的家切到房间工作区里的另一个会话。 */
    function HomeSwitch(props) {
      var state = useState(null); var homes = state[0]; var setHomes = state[1]
      var msgState = useState(''); var msg = msgState[0]; var setMsg = msgState[1]
      var busyState = useState(false); var busy = busyState[0]; var setBusy = busyState[1]
      function load() {
        fetch('/dsh-world/console/homes', { cache: 'no-store' })
          .then(function (r) { return r.json() })
          .then(function (v) { setHomes(list(v && v.homes)) }, function () { setHomes([]) })
      }
      useEffect(load, [])
      function pick(id) {
        if (!id || busy) return
        setBusy(true); setMsg('切换中…')
        fetch('/dsh-world/console/home', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-world': '1' }, body: JSON.stringify({ sessionId: id }) })
          .then(function (r) { return r.json().then(function (v) { return { ok: r.ok, v: v } }) })
          .then(function (res) {
            if (!res.ok || res.v.ok === false) { setMsg('切换失败：' + ((res.v && res.v.error) || '未知原因')); return }
            setMsg('已换到 ' + String(id).replace(/^session-/, '').slice(0, 8) + '，她会先打个招呼。')
            if (props.onSaved) props.onSaved()
            load()
          }, function (e) { setMsg('切换失败：' + (e.message || e)) })
          .then(function () { setBusy(false) })
      }
      var current = props.current || ''
      return h('div', { style: { marginTop: 12, paddingTop: 10, borderTop: '1px dashed var(--line)' } },
        h('div', { className: 'dw-muted', style: { marginBottom: 6, fontSize: 12 } }, '换家：先在侧边栏那个房间工作区里新建一个会话并点开它一次，再回来选它。'),
        homes === null
          ? h('div', { className: 'dw-muted' }, '读取中…')
          : homes.length === 0
            ? h('div', { className: 'dw-muted' }, '这个房间里还没有别的会话。')
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                homes.map(function (item) {
                  var label = (item.title || String(item.id).replace(/^session-/, '').slice(0, 8)) + (item.archived ? '（已归档，不能当家用）' : '')
                  var isCur = item.current || item.id === current
                  return h('label', { key: item.id, style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, opacity: item.archived ? 0.5 : 1 } },
                    h('input', { type: 'radio', name: 'dw-home', checked: isCur, disabled: busy || item.archived, onChange: function () { pick(item.id) } }),
                    h('span', null, label),
                    isCur ? h('span', { className: 'dw-muted' }, '· 现在是她家') : null)
                })),
        msg ? h('div', { className: 'dw-muted', style: { marginTop: 6, fontSize: 12 } }, msg) : null)
    }
    function Digest(props) {
      var state = useState(null), data = state[0], setData = state[1]
      var groupState = useState('all'), group = groupState[0], setGroup = groupState[1]
      var kindState = useState('all'), kind = kindState[0], setKind = kindState[1]
      var dayState = useState(''), day = dayState[0], setDay = dayState[1]
      var msgState = useState(''), msg = msgState[0], setMsg = msgState[1]
      function load() {
        fetch('/dsh-qq-group/world/digest', { cache: 'no-store' }).then(function (r) { return r.json() }).then(function (v) { setData(v) }, function () { setData(null) })
      }
      useEffect(load, [])
      function act(payload) {
        fetch('/dsh-qq-group/world/digest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).then(function (r) { return r.json() }).then(function () { setMsg('已更新'); load() }, function (e) { setMsg('失败：' + (e.message || e)) })
      }
      var entries = list(data && data.entries)
      var groups = list(data && data.groups)
      var shown = entries.filter(function (e) {
        if (group !== 'all' && e.groupId !== group) return false
        if (kind === 'self' && e.self !== true) return false
        if (kind === 'others' && e.self === true) return false
        if (day !== '' && new Date(e.at).toLocaleDateString('en-CA') !== day) return false
        return true
      })
      return h('div', { className: 'dw-pane' },
        h(Card, { title: '群对话', delay: 60 },
          h('div', { className: 'dw-muted' }, '群里的话一进来就记下来，实时更新。这是流水，不是记忆——记忆在「记忆」页。她读的是 room/群近况.md（最近 40 条，和 QQ 插件读的同一份）；这里是你管理的完整记录。'),
          h('div', { className: 'dw-setting' },
            h('span', { className: 'dw-muted' }, '共 ' + entries.length + ' 条 · 我 ' + (data && data.selfCount ? data.selfCount : 0) + ' 条'),
            h('select', { value: group, onChange: function (e) { setGroup(e.target.value) } },
              h('option', { value: 'all' }, '全部群'),
              groups.map(function (g) { return h('option', { key: g, value: g }, '群 ' + g) })),
            h('select', { value: kind, onChange: function (e) { setKind(e.target.value) } },
              h('option', { value: 'all' }, '全部'),
              h('option', { value: 'self' }, '我说的'),
              h('option', { value: 'others' }, '别人说的')),
            h('input', { type: 'date', value: day, onChange: function (e) { setDay(e.target.value) } }),
            day ? h('button', { className: 'dw-btn', onClick: function () { setDay('') } }, '全部日期') : null,
            h('button', { className: 'dw-btn', onClick: function () { if (!window.confirm('清空全部群聊见闻？她说的话也会一起清掉。')) return; act({ action: 'clear' }) } }, '清空')),
          h('div', { className: 'dw-traces' }, shown.length === 0
            ? h('div', { className: 'dw-muted' }, '没有符合条件的记录')
            : shown.slice(0, 200).map(function (e, i, arr) {
                var d = new Date(e.at).toLocaleDateString('zh-CN')
                var prev = i > 0 ? new Date(arr[i - 1].at).toLocaleDateString('zh-CN') : ''
                return h('div', { key: e.id || i, className: 'dw-setting' },
                  d !== prev ? h('div', { className: 'dw-muted', style: { paddingBottom: '2px' } }, d) : null,
                  h('span', { className: 'dw-muted' }, new Date(e.at).toLocaleTimeString('zh-CN', { hour12: false }) + ' · 群 ' + e.groupId + ' · ' + (e.self ? '我' : e.name)),
                  h('span', { style: { display: 'block', whiteSpace: 'pre-wrap' } }, String(e.text || '')),
                  h('button', { className: 'dw-btn', onClick: function () { act({ action: 'delete', ids: [e.id] }) } }, '删'))
              })),
          msg ? h('div', { className: 'dw-muted' }, msg) : null))
    }

    /** 域的中文名；UI 和提示词用同一套说法。 */
    function domainLabel(d) {
      if (d === 'owner') return '和主人的记忆'
      if (d === 'group') return '群聊记忆'
      if (d === 'work') return '工作'
      return '记忆'
    }

    /**
     * 记忆：她记得的所有事，一份。
     * 和主人的记忆衰减最慢、群聊居中、工作最快；被想起会变清楚。
     * 每条是「发生了什么」加「当时怎么想」，不只是档案。
     */
    function Traces(props) {
      var state = useState([]), items = state[0], setItems = state[1]
      var textState = useState(''), text = textState[0], setText = textState[1]
      var domainState = useState('owner'), domain = domainState[0], setDomain = domainState[1]
      var msgState = useState(''), msg = msgState[0], setMsg = msgState[1]
      var filterState = useState('all'), traceFilter = filterState[0], setTraceFilter = filterState[1]
      var sortState = useState('activation'), traceSort = sortState[0], setTraceSort = sortState[1]
      var dayState = useState(''), traceDay = dayState[0], setTraceDay = dayState[1]
      /** 记忆星图：应用内浮层。Electron 禁了 window.open 和跳转，只能自己嵌 iframe。 */
      var atlasState = useState(false), atlasOpen = atlasState[0], setAtlasOpen = atlasState[1]
      function load() {
        fetch('/dsh-qq-group/world/traces', { cache: 'no-store' }).then(function (r) { return r.json() }).then(function (v) { setItems(list(v && v.traces)) }, function () { setItems([]) })
      }
      useEffect(load, [])
      function act(payload) {
        fetch('/dsh-qq-group/world/traces', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }).then(function (r) { return r.json() }).then(function () { setMsg('已保存'); load() }, function (e) { setMsg('失败：' + (e.message || e)) })
      }
      function add() { if (text.trim() === '') return; act({ action: 'add', text: text, domain: domain }); setText('') }
      var countOf = function (d) { return items.filter(function (t) { return t.domain === d }).length }
      var shown = items.filter(function (t) {
        return (traceFilter === 'all' || t.domain === traceFilter) &&
          (traceDay === '' || new Date(t.createdAt).toLocaleDateString('en-CA') === traceDay)
      }).sort(function (a, b) {
        return traceSort === 'activation' ? (b.activation || 0) - (a.activation || 0) : (b.createdAt || 0) - (a.createdAt || 0)
      })
      var filterOptions = [['all', '全部'], ['owner', domainLabel('owner')], ['group', domainLabel('group')], ['work', domainLabel('work')]]
      return h('div', { className: 'dw-pane' },
atlasOpen ? h('div', { style: { position: 'fixed', left: 0, top: 0, width: '100%', height: '100%', zIndex: 90, background: '#030611' } }, h('iframe', { src: '/dsh-qq-group/world/atlas', title: '记忆星图', allow: 'fullscreen', allowFullScreen: true, style: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', border: 0, display: 'block' } }), h('button', { title: '关闭星图', onClick: function () { setAtlasOpen(false) }, style: { position: 'absolute', right: '14px', bottom: '14px', zIndex: 95, width: '38px', height: '38px', borderRadius: '50%', border: '1px solid rgba(255,255,255,.22)', background: 'rgba(10,16,26,.62)', color: '#e8edf4', fontSize: '17px', lineHeight: '1', cursor: 'pointer', backdropFilter: 'blur(6px)' } }, '✕')) : null,
                h(Card, { title: '记忆', delay: 60 },
          h('div', { className: 'dw-setting', style: { marginBottom: '10px' } },
            h('button', {
              className: 'dw-btn',
              style: { fontWeight: 600 },
              onClick: function () { setAtlasOpen(true) }
            }, '✦ 打开记忆星图'),
            h('span', { className: 'dw-muted', style: { marginLeft: '10px' } }, '每一颗星是一条记忆：金色圈的是钉住的，亮的是常被想起的，暗的是正在淡去的。星图直接读这里的记忆，看到的就是最新的。')),
          h('div', { className: 'dw-muted' }, '她记得的所有事都在这里，一份。每条是「发生了什么」加「当时怎么想」。和主人的记忆影响她是谁，衰减最慢；群聊居中；工作掉得最快。被想起会变清楚。'),
          h('div', { className: 'dw-setting', style: { flexWrap: 'wrap', gap: '8px' } },
            filterOptions.map(function (pair) {
              var key = pair[0], label = pair[1]
              var n = key === 'all' ? items.length : countOf(key)
              return h('button', {
                key: key,
                className: 'dw-btn' + (traceFilter === key ? ' on' : ''),
                style: traceFilter === key ? { fontWeight: 600 } : null,
                onClick: function () { setTraceFilter(key) }
              }, label + ' ' + n)
            }),
            h('select', { value: traceSort, onChange: function (e) { setTraceSort(e.target.value) } }, h('option', { value: 'activation' }, '最近激活'), h('option', { value: 'created' }, '最近创建')),
            h('input', { type: 'date', value: traceDay, onChange: function (e) { setTraceDay(e.target.value) } }),
            traceDay ? h('button', { className: 'dw-btn', onClick: function () { setTraceDay('') } }, '显示全部日期') : null,
            h('button', { className: 'dw-btn', onClick: function () { if (!window.confirm('清空全部工作痕迹？和主人的记忆、群聊记忆和日记都不受影响，清空后不能从界面恢复。')) return; act({ action: 'clear-domain', domain: 'work' }) } }, '清空工作痕迹')),
          shown.length ? h('div', { className: 'dw-traces' }, shown.map(function (t, i, array) {
            var day = new Date(t.createdAt).toLocaleDateString('zh-CN')
            var previous = i > 0 ? new Date(array[i - 1].createdAt).toLocaleDateString('zh-CN') : ''
            var activation = Math.round((t.activation || 0) * 100)
            return h('div', { key: t.id || i, className: 'dw-setting', style: { flexWrap: 'wrap', alignItems: 'flex-start', gap: '6px' } },
              day !== previous ? h('div', { className: 'dw-muted', style: { width: '100%', paddingBottom: '2px' } }, day) : null,
              h('span', { className: 'dw-muted', style: { minWidth: '230px' } },
                domainLabel(t.domain) + ' · 激活 ' + activation + '% · 半衰期 ' + Math.round(t.effectiveHalfLifeDays || 0) + '天 · 想起 ' + (t.recallCount || 0)),
              h('div', { className: 'dw-meter', style: { width: '80px' } }, h('i', { style: { width: Math.max(2, activation) + '%' } })),
              h('span', { style: { flex: '1 1 240px' } },
                String(t.text || ''),
                t.feeling ? h('div', { className: 'dw-muted', style: { fontSize: '12px', paddingTop: '2px' } }, '当时想：' + t.feeling) : null),
              h('button', { className: 'dw-btn', onClick: function () { var next = window.prompt('编辑这条记忆', t.text || ''); if (next !== null) act({ action: 'update', id: t.id, text: next }) } }, '编辑'),
              h('button', { className: 'dw-btn', onClick: function () { act({ action: 'recall', ids: [t.id] }) } }, '想起'),
              h('button', { className: 'dw-btn', onClick: function () { if (!window.confirm('确定删除这条记忆？删除后不能从界面恢复。')) return; act({ action: 'delete', ids: [t.id] }) } }, '删'))
          })) : h('div', { className: 'dw-muted' }, '这个条件下没有记忆'),
          msg ? h('div', { className: 'dw-muted' }, msg) : null),
        h(Card, { title: '新记一件事', delay: 120 },
          h('div', { className: 'dw-setting' },
            h('select', { value: domain, onChange: function (e) { setDomain(e.target.value) } },
              h('option', { value: 'owner' }, domainLabel('owner')),
              h('option', { value: 'group' }, domainLabel('group')),
              h('option', { value: 'work' }, domainLabel('work'))),
            h('input', { type: 'text', placeholder: '一条值得记住的事', value: text, onChange: function (e) { setText(e.target.value) } }),
            h('button', { className: 'dw-btn', onClick: add }, '添加'))))
    }

    function Records(props) {
      var snap = props.snap, zone = snap.timeZone, life = snap.life, compactions = list(snap.compactions)
      return h('div', { className: 'dw-pane' },
        h(Fold, { title: '活动记录', defaultOpen: false, hint: '点开看每一天做了什么' },
          h(Activity, { bare: true, days: list(snap.activityDays), zone: zone, tick: props.tick })),
        h(Entertainment, { days: list(snap.activityDays), zone: zone, tick: props.tick }),
        h(Diary, { dates: list(snap.diaryDates) }),
        h(Card, { title: '压缩' }, compactions.length ? h('table', null, h('tbody', null, compactions.map(function (c, i) {
          return h('tr', { key: i }, h('td', { className: 'dw-muted' }, local(c.time, zone)), h('td', null, life && c.sessionId === life.homeSessionId ? '家' : String(c.sessionId || '').slice(-8)), h('td', { className: c.ok ? 'dw-ok' : 'dw-bad' }, c.ok ? '成功' : '失败：' + (c.error || '')), h('td', { className: 'dw-muted' }, c.shadowedTokens ? '缩掉约 ' + c.shadowedTokens + ' token' : ''))
        }))) : h('div', { className: 'dw-muted' }, '还没有压缩记录')))
    }

    var cell = { padding: '4px 10px 4px 0', whiteSpace: 'nowrap' }
    var num = function (v) { return typeof v === 'number' && isFinite(v) ? String(Math.round(v)) : '—' }
    var pct = function (a, b) { return b > 0 ? Math.round((a / b) * 100) + '%' : '—' }

    /**
     * 主动联系：她自己想说话的时候，花了多少钱、说成了几条、被规则拦下几条。
     *
     * 数据全部来自桥的 /api/socialV2/proactive（经 /dsh-world/qq/proactive 透出来），
     * 这一页只读：开关在桥那边（config.json 的 socialV2.proactiveEngine）。
     */
    /**
     * 她的身体（2026-11-04）
     *
     * VTS 开着时展示模型、表情、动作；没开就显示"没开"和一句怎么开，
     * 不是一片红色报错——没开是正常状态，不是故障。
     */
    function Body() {
      var s = useState(null), data = s[0], setData = s[1]
      var e = useState(null), error = e[0], setError = e[1]
      var busy = useState(false), checking = busy[0], setChecking = busy[1]
      var act = useState(null), actionMsg = act[0], setActionMsg = act[1]
      var st = useState(false), starting = st[0], setStarting = st[1]

      function startPet() {
        setStarting(true); setActionMsg(null)
        fetch('/dsh-world/console/body/start', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-dsh-world': '1' }, body: '{}' })
          .then(settle).then(function (r) {
            setStarting(false)
            setActionMsg(r.already ? '透明窗已经在跑了。' : r.ok ? '已启动 —— 窗口正在加载模型，几秒内出现。' : '启动失败：' + (r.reason ?? '未知'))
          }, function (err) {
            setStarting(false); setActionMsg('启动失败：' + String((err && err.message) || err))
          })
      }

      function load() {
        return fetch('/dsh-world/console/body', { cache: 'no-store' }).then(settle).then(function (d) {
          setData(d); setError(null); return d
        }, function (err) {
          setData(null); setError(String((err && err.message) || err)); return null
        })
      }
      useEffect(function () {
        var alive = true
        load()
        var timer = setInterval(function () { if (document.visibilityState === 'visible') load() }, 20000)
        return function () { alive = false; clearInterval(timer) }
      }, [])

      function recheck() {
        setChecking(true); setActionMsg(null)
        load().then(function () { setChecking(false) })
      }

      if (error) return h(Card, { title: '她的身体' }, h('div', { className: 'dw-muted' }, '读取失败：' + error))
      if (!data) return h(Card, { title: '她的身体' }, h('div', { className: 'dw-muted' }, '读取中…'))

      if (data.connected !== true) {
        return h(Card, { title: '她的身体' }, h('div', null,
          h('div', { className: 'dw-muted', style: { marginBottom: 8 } }, 'VTube Studio 没连上 —— 这不影响聊天、记忆、QQ，只是她现在动不了。'),
          h('div', { className: 'dw-bad', style: { marginBottom: 10 } }, data.reason || '未知原因'),
          h('div', { style: { marginBottom: 12 } },
            h('button', { className: 'dw-btn', disabled: starting, onClick: startPet },
              starting ? '启动中…' : '启动桌面形象（透明窗）'),
            h('span', { className: 'dw-muted', style: { marginLeft: 8 } }, '透明窗不依赖 VTS，也不依赖 OBS。')),
          h('div', { className: 'dw-muted', style: { marginBottom: 6, fontWeight: 600 } }, '如果想让 VTS 本体的背景也透明：'),
          h('ol', { className: 'dw-muted', style: { margin: '0 0 10px 18px', lineHeight: 1.9 } },
            h('li', null, '打开 VTube Studio（Steam 里启动）'),
            h('li', null, '确认设置里「开启 API」是开的，端口 ', String(data.port || 8001)),
            h('li', null, '如果它弹了授权窗口，点「允许」'),
            h('li', null, '回来点下面的「重新检查」')),
          h('button', { className: 'dw-btn', disabled: checking, onClick: recheck }, checking ? '检查中…' : '重新检查')))
      }

      var faces = list(data.faces), active = list(data.activeFaces), gestures = list(data.gestures)
      return h(Card, { title: '她的身体' }, h('div', null,
        h('div', { className: 'dw-muted', style: { marginBottom: 8 } },
          '已连上 · 端口 ' + data.port + ' · 模型「' + (data.model || '?') + '」' + (data.loaded ? '' : '（还没加载）')),
        h('div', { style: { marginBottom: 10 } },
          h('span', { className: 'dw-muted' }, '表情 ' + faces.length + ' 个：'),
          h('span', null, faces.join('、') || '（读不到）')),
        active.length > 0 ? h('div', { className: 'dw-muted', style: { marginBottom: 10 } }, '正在做：' + active.join('、')) : null,
        h('div', { style: { marginBottom: 10 } },
          h('span', { className: 'dw-muted' }, '双手动作 ' + gestures.length + ' 个：'),
          h('span', null, gestures.join('、') || '（读不到）')),
        h('div', { className: 'dw-muted', style: { marginBottom: 10, fontSize: 12 } },
          '她能自己用这三个工具：make_face（表情）、gesture（双手动作）、body_tilt（歪头点头）。'),
        actionMsg ? h('div', { className: 'dw-muted', style: { marginTop: 8 } }, actionMsg) : null,
        h('button', { className: 'dw-btn', disabled: checking, onClick: recheck }, checking ? '检查中…' : '刷新')))
    }

    function Proactive() {
      var s = useState(null), data = s[0], setData = s[1]
      var e = useState(null), error = e[0], setError = e[1]
      var s2 = useState(false), saving = s2[0], setSaving = s2[1]
      var s3 = useState(null), saveError = s3[0], setSaveError = s3[1]
      useEffect(function () {
        var alive = true
        function load() {
          fetch('/dsh-qq-group/world/proactive', { cache: 'no-store' }).then(settle).then(function (d) {
            if (!alive) return
            setData(d); setError(null)
          }, function (err) {
            if (!alive) return
            setData(null); setError(String((err && err.message) || err))
          })
        }
        load()
        var timer = setInterval(function () { if (document.visibilityState === 'visible') load() }, 15000)
        return function () { alive = false; clearInterval(timer) }
      }, [])
      if (error) return h('div', { className: 'dw' }, h('div', { className: 'dw-muted' }, '读不到主动联系的统计：' + error))
      if (!data) return h('div', { className: 'dw' }, h('div', { className: 'dw-muted' }, '读取中…'))
      var today = data.today || {}, usage = data.usage || {}, policy = data.policy || {}
      var series = Array.isArray(data.usageSeries) ? data.usageSeries : []
      var reports = Array.isArray(data.reports) ? data.reports : []
      var cap = policy.maxCallsPerDay
      // 改开关：写进去以后立刻按新值画，不等 15 秒那一轮轮询。
      function flip(patch) {
        setSaving(true); setSaveError(null)
        fetch('/dsh-qq-group/world/proactive', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch || {}) }).then(settle).then(function () {
          setData(Object.assign({}, data, patch)); setSaving(false)
        }, function (err) {
          setSaveError(String((err && err.message) || err)); setSaving(false)
        })
      }
      function toggleRow(label, hint, on, key) {
        return h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, marginRight: 18, cursor: saving ? 'default' : 'pointer' } },
          h('input', {
            type: 'checkbox', checked: on === true, disabled: saving,
            onChange: function (e) { var patch = {}; patch[key] = e.target.checked; flip(patch) }
          }),
          h('span', null, label),
          h('span', { className: 'dw-muted', style: { fontSize: 12 } }, hint))
      }
      var flags = []
      if (data.enabled !== true) flags.push('未启用')
      if (data.dryRun !== false) flags.push('演练模式（不真的发）')
      if (data.running !== true) flags.push('调度器没在跑')
      return h('div', { className: 'dw' },
        h('div', { className: 'dw-title' },
          h('h2', null, '主动联系'),
          h('div', { className: 'dw-state' },
            h('i', { className: 'dw-dot' }),
            data.enabled === true ? '开着' : '关着',
            flags.length ? h('span', { className: 'dw-bad' }, ' · ' + flags.join(' · ')) : null)),
        h('div', null,
          h('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 } },
          toggleRow('主动联系', '关掉就不再自己开口', data.enabled, 'enabled'),
          toggleRow('演练模式', '只判断、不真的发出去', data.dryRun, 'dryRun'),
          saving ? h('span', { className: 'dw-muted' }, '保存中…') : null,
          saveError ? h('span', { className: 'dw-bad' }, '没存上：' + saveError) : null),
        h('div', { style: { marginBottom: 6 } }, '今天（' + (today.dayKey || '—') + '）'),
          h('table', { style: { borderCollapse: 'collapse', marginBottom: 14 } },
            h('tbody', null,
              h('tr', null,
                h('td', { style: cell }, '调用 AI'),
                h('td', { style: cell }, num(today.calls) + (typeof cap === 'number' && cap > 0 ? ' / ' + cap : '')),
                h('td', { style: cell }, typeof cap === 'number' && cap > 0 ? '用了 ' + pct(today.calls, cap) : '不限')),
              h('tr', null,
                h('td', { style: cell }, '主动消息'),
                h('td', { style: cell }, num(today.messages)),
                h('td', { style: cell }, '送出 ' + num(today.sent) + ' 条')),
              h('tr', null,
                h('td', { style: cell }, '被规则拦下'),
                h('td', { style: cell }, num(today.suppressed)),
                h('td', { style: cell }, '待处理 ' + num(today.pending))),
              h('tr', null,
                h('td', { style: cell }, '平均 token'),
                h('td', { style: cell }, usage.sampled > 0 ? '入 ' + num(usage.avgInputTokens) + ' / 出 ' + num(usage.avgOutputTokens) : '未上报'),
                h('td', { style: cell }, usage.sampled > 0 ? '样本 ' + usage.sampled + ' / ' + num(usage.calls) + ' 次' : 'provider 没给用量')))),
        h('div', { style: { marginBottom: 6 } }, '近 7 天'),
        h('table', { style: { borderCollapse: 'collapse', marginBottom: 14 } },
          h('thead', null, h('tr', null,
            ['日期', '调用', '平均入', '平均出', '主动消息'].map(function (t) { return h('th', { key: t, style: Object.assign({}, cell, { textAlign: 'left', color: 'inherit', opacity: 0.6 }) }, t) }))),
          h('tbody', null, series.map(function (d) {
            return h('tr', { key: d.dayKey },
              h('td', { style: cell }, d.dayKey),
              h('td', { style: cell }, num(d.calls)),
              h('td', { style: cell }, d.sampled > 0 ? num(d.avgInputTokens) : '—'),
              h('td', { style: cell }, d.sampled > 0 ? num(d.avgOutputTokens) : '—'),
              h('td', { style: cell }, num(d.messages)))
          }))),
        h('div', { style: { marginBottom: 6 } }, '最近几次判断'),
        reports.length === 0
          ? h('div', { className: 'dw-muted' }, '还没有记录')
          : h('div', null, reports.slice(0, 8).map(function (r, i) {
            var blocked = Array.isArray(r.blocked) ? r.blocked.join(' / ') : ''
            return h('div', { key: i, style: { padding: '3px 0', opacity: 0.85 } },
              (r.decision || '—') + (blocked ? '（' + blocked + '）' : '') + (r.text ? '：' + r.text : ''))
          }))))
    }

    var TABS = [['overview', '概览'], ['persona', '人设'], ['prompt', '世界提示词'], ['records', '活动记录'], ['diary', '日记'], ['traces', '记忆'], ['digest', '群对话']]
    /** 一份快照的画面；life 为 null（停着，或生活线没能启动）或缺了哪一块都不会崩。 */
    var BoundaryBase = react.Component || class {
      constructor(props) { this.props = props; this.state = { error: null } }
      setState(next) { this.state = Object.assign({}, this.state, next) }
      render() { return this.props.children }
    }
    class TabBoundary extends BoundaryBase {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error: error } }
      componentDidCatch(error) { try { console.error('[dsh-world] tab render failed', error) } catch (e) {} }
      render() {
        if (this.state.error) return h('div', { className: 'dw-pane' }, h(Card, { title: '这一页出错了' },
          h('div', { className: 'dw-bad' }, String(this.state.error && this.state.error.message || this.state.error)),
          h('button', { className: 'dw-btn', onClick: function () { this.setState({ error: null }) }.bind(this) }, '重试')))
        return this.props.children
      }
    }

    function View(props) {
      var snap = props.snap, error = props.error
      var tabState = useState('overview'), tab = tabState[0], setTab = tabState[1]
      var panelState = useState(null), panel = panelState[0], setPanel = panelState[1]
      var busyState = useState(false), busy = busyState[0], setBusy = busyState[1]
      var failState = useState(null), fail = failState[0], setFail = failState[1]
      var running = snap.running === true
      var name = snap.name && snap.name !== 'TA' ? snap.name : ''
      function power() {
        if (running && !window.confirm('停止后，她不会再被叫醒，记忆块、人设和世界提示词都会撤下，这段时间的对话也不记。要停止吗？')) return
        setBusy(true); setFail(null)
        post(running ? 'stop' : 'start').then(function () { props.refresh() }, function (e) { setFail(String(e.message || e)) }).then(function () { setBusy(false) })
      }
      return h('div', { className: 'dw' },
        h('header', { className: 'dw-head' + (running ? ' dw-on' : '') },
          h('div', { className: 'dw-title' },
            h('small', null, 'world · ' + snap.worldId),
            h('h2', null, (name || '她') + '的世界'),
            h('div', { className: 'dw-state' }, h('i', { className: 'dw-dot' }), running ? '运行中' : '已停止', ' · ', local(snap.now, snap.timeZone),
              error ? h('span', { className: 'dw-bad' }, ' · 刷新失败：' + error) : null,
              fail ? h('span', { className: 'dw-bad' }, ' · ' + fail) : null)),
          h('button', { className: 'dw-power' + (running ? ' stop' : ''), disabled: busy, onClick: power }, busy ? '……' : running ? '停止' : '开始')),
        h('nav', { className: 'dw-tabs' }, TABS.map(function (t) { return h('button', { key: t[0], className: 'dw-tab' + (tab === t[0] ? ' on' : ''), onClick: function () { setTab(t[0]) } }, t[1]) })),
        tab === 'overview' ? h(Overview, { snap: snap, refresh: props.refresh, onNeedPassword: setPanel }) : null,
        tab === 'persona' ? h(PersonaEditor, { onSaved: props.refresh }) : null,
        tab === 'prompt' ? h(PromptEditor) : null,
        tab === 'records' ? h(Records, { snap: snap, tick: props.tick }) : null,
        tab === 'diary' ? h(TabBoundary, null, h('div', { className: 'dw-pane' }, h(Diary, { dates: list(snap.diaryDates) }))) : null,
        tab === 'traces' ? h(TabBoundary, null, h(Traces, null)) : null,
        tab === 'digest' ? h(TabBoundary, null, h(Digest, null)) : null,
        panel ? h(Panel, { kind: panel, onClose: function () { setPanel(null) } }) : null)
    }

    function Console() {
      var snapState = useState(null), snap = snapState[0], setSnap = snapState[1]
      var errorState = useState(null), error = errorState[0], setError = errorState[1]
      var offState = useState(false), off = offState[0], setOff = offState[1]
      var tickState = useState(0), tick = tickState[0], setTick = tickState[1]
      var loadRef = useRef(null)
      useEffect(function () {
        ensureStyle()
        var alive = true, pending = false, timer = null
        function load() {
          if (!alive || pending) return
          pending = true
          loadSnapshot().then(function (s) {
            pending = false
            if (!alive) return
            if (s === null) { setOff(true); if (timer) { clearInterval(timer); timer = null } return }
            setSnap(s); setError(null); setTick(function (t) { return t + 1 })
          }, function (e) {
            pending = false
            if (alive) setError(String((e && e.message) || e))
          })
        }
        function onVisible() { if (document.visibilityState === 'visible') load() }
        loadRef.current = load
        load()
        timer = setInterval(onVisible, 10000)
        document.addEventListener('visibilitychange', onVisible)
        return function () { alive = false; loadRef.current = null; if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
      }, [])
      if (off) return h('div', { className: 'dw' }, h('div', { className: 'dw-muted' }, '世界控制台需要桌面版宿主'))
      if (!snap) return h('div', { className: 'dw' }, error ? h('div', { className: 'dw-bad' }, '读取失败：' + error) : h('div', { className: 'dw-muted' }, '读取中…'))
      return h(View, { snap: snap, error: error, tick: tick, refresh: function () { if (loadRef.current) loadRef.current() } })
    }

    var exports = { inject: ['slots'] }
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    exports.apply = function (ctx) {
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({ name: 'settings.section', id: 'world-console', order: 28, label: '世界控制台' }, function () { return h(Console) })
      })
      /*
       * 她的身体单独一个设置分区（2026-11-04）。
       *
       * 为什么不塞进「世界控制台」：那边已经很长了，而"她能不能动"
       * 是个独立问题（VTS 开没开），单独一栏一眼就能看。
       */
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({ name: 'settings.section', id: 'world-body', order: 29, label: '她的身体' }, function () { return h(Body) })
      })
      /*
       * 她写的信（2026-11-08 从「鱼与人」搬过来）。
       * 单独一栏：信是日子的一部分，不该藏在几百个开关里。
       */
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({ name: 'settings.section', id: 'world-letters', order: 30, label: '她写的信' }, function () { return h(Letters) })
      })
    }
    Object.defineProperty(exports, '__test', { value: { Modules: Modules, Wechat: Wechat, Activity: Activity, Diary: Diary, Qq: Qq, Panel: Panel, View: View, Overview: Overview, PersonaEditor: PersonaEditor, PromptEditor: PromptEditor, ContextBudget: ContextBudget, loadSnapshot: loadSnapshot, renderPersona: renderPersona, Proactive: Proactive, Body: Body, Letters: Letters }, enumerable: false })
    return exports
  },
})
