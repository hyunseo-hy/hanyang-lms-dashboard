import { useState, useEffect, useRef } from 'react';

const LMS_COOKIE_KEY = 'lms_session_cookie';

export default function Home() {
  const [cookie, setCookie] = useState('');
  const [savedCookie, setSavedCookie] = useState('');
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [filter, setFilter] = useState('all');
  const [myUserId, setMyUserId] = useState(null);
  const [intervalSec, setIntervalSec] = useState(300);
  const [nextRefreshIn, setNextRefreshIn] = useState(null);
  const autoTimer = useRef(null);
  const countTimer = useRef(null);
  const nextAt = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem(LMS_COOKIE_KEY) || '';
    if (saved) { setSavedCookie(saved); setCookie(saved); }
  }, []);

  async function lmsFetch(endpoint) {
    const res = await fetch('/api/proxy?endpoint=' + encodeURIComponent(endpoint), {
      headers: { 'x-lms-cookie': savedCookie || cookie }
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function fetchData() {
    const ck = savedCookie || cookie;
    if (!ck) return alert('LMS 쿠키를 먼저 입력해주세요.');
    setLoading(true);
    try {
      const self = await lmsFetch('/api/v1/users/self');
      setMyUserId(self.id);
      const myId = self.id;

      const courses = await lmsFetch('/api/v1/courses?enrollment_state=active&per_page=50');
      const all = [];
      for (const c of courses) {
        const [asgns, discs] = await Promise.all([
          lmsFetch('/api/v1/courses/' + c.id + '/assignments?per_page=100&include[]=submission').catch(() => []),
          lmsFetch('/api/v1/courses/' + c.id + '/discussion_topics?per_page=100').catch(() => []),
        ]);
        if (Array.isArray(asgns)) {
          for (const a of asgns) {
            if (a.submission_types.includes('none') && !a.due_at) continue;
            all.push({ courseId: c.id, courseName: c.name, id: 'a_' + a.id, name: a.name, due_at: a.due_at, lock_at: null, submission_types: a.submission_types, submitted: a.submission ? (a.submission.workflow_state === 'submitted' || a.submission.workflow_state === 'graded') : false, workflow_state: a.submission ? a.submission.workflow_state : 'unsubmitted', kind: 'assignment' });
          }
        }
        if (Array.isArray(discs)) {
          for (const d of discs.filter(d => !d.is_announcement)) {
            try {
              const view = await lmsFetch('/api/v1/courses/' + c.id + '/discussion_topics/' + d.id + '/view');
              const me = view.view ? view.view.filter(e => e.user_id === myId).length : 0;
              all.push({ courseId: c.id, courseName: c.name, id: 'd_' + d.id, name: d.title, due_at: (d.assignment && d.assignment.due_at) || null, lock_at: d.lock_at || null, submission_types: ['discussion_topic'], submitted: me > 0, workflow_state: me > 0 ? 'submitted' : 'unsubmitted', kind: 'discussion' });
            } catch {}
          }
        }
      }
      setAssignments(all);
      setLastRefresh(new Date());
    } catch (e) {
      alert('오류: ' + e.message);
    }
    setLoading(false);
  }

  function saveCookie() {
    localStorage.setItem(LMS_COOKIE_KEY, cookie);
    setSavedCookie(cookie);
    alert('저장됨! 이제 갱신 버튼을 누르세요.');
  }

  function getDd(d) {
    if (!d) return null;
    const now = new Date(), due = new Date(d);
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dm = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    return Math.ceil((dm - t) / 86400000);
  }
  function getDeadline(a) { return a.due_at || a.lock_at || null; }
  function getStatus(a) {
    if (a.submitted) return 'done';
    const dl = getDeadline(a);
    if (!dl) return 'nodate';
    return getDd(dl) < 0 ? 'overdue' : 'pending';
  }
  function fmtDate(d) {
    if (!d) return '-';
    return new Date(d).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' });
  }

  const courseMap = {};
  for (const a of assignments) {
    if (!courseMap[a.courseName]) courseMap[a.courseName] = [];
    courseMap[a.courseName].push(a);
  }
  const filtered = Object.fromEntries(
    Object.entries(courseMap).map(([cn, ca]) => {
      let fa = ca;
      if (filter === 'pending') fa = ca.filter(a => getStatus(a) === 'pending');
      else if (filter === 'done') fa = ca.filter(a => getStatus(a) === 'done');
      else if (filter === 'overdue') fa = ca.filter(a => getStatus(a) === 'overdue');
      else if (filter === 'upcoming') fa = ca.filter(a => { if (a.submitted || !getDeadline(a)) return false; const d = getDd(getDeadline(a)); return d >= 0 && d <= 7; });
      fa.sort((a, b) => { const da = getDeadline(a), db = getDeadline(b); if (!da && !db) return 0; if (!da) return 1; if (!db) return -1; return new Date(da) - new Date(db); });
      return [cn, fa];
    }).filter(([, fa]) => fa.length > 0)
  );

  const tot = Object.values(filtered).flat().length;
  const don = Object.values(filtered).flat().filter(a => getStatus(a) === 'done').length;
  const pen = Object.values(filtered).flat().filter(a => getStatus(a) === 'pending').length;
  const ove = Object.values(filtered).flat().filter(a => getStatus(a) === 'overdue').length;

  function ddayText(a) {
    if (a.submitted) return { text: '✓ 완료', cls: 'done' };
    const dl = getDeadline(a); if (!dl) return { text: '-', cls: 'none' };
    const d = getDd(dl);
    if (d < 0) return { text: 'D+' + (-d) + ' 초과', cls: 'urgent' };
    if (d === 0) return { text: '🔥 D-Day!', cls: 'urgent' };
    if (d <= 3) return { text: 'D-' + d, cls: 'urgent' };
    if (d <= 7) return { text: 'D-' + d, cls: 'soon' };
    if (d <= 14) return { text: 'D-' + d, cls: 'normal' };
    return { text: 'D-' + d, cls: 'future' };
  }

  const ddayColors = { done: '#4ade80', urgent: '#f87171', soon: '#fb923c', normal: '#facc15', future: '#60a5fa', none: '#64748b' };
  const badgeStyle = (s) => {
    const m = { done: { bg: 'rgba(74,222,128,.15)', color: '#4ade80', border: 'rgba(74,222,128,.35)' }, pending: { bg: 'rgba(251,146,60,.15)', color: '#fb923c', border: 'rgba(251,146,60,.35)' }, overdue: { bg: 'rgba(248,113,113,.15)', color: '#f87171', border: 'rgba(248,113,113,.35)' }, nodate: { bg: 'rgba(148,163,184,.12)', color: '#94a3b8', border: 'rgba(148,163,184,.3)' }, graded: { bg: 'rgba(96,165,250,.15)', color: '#60a5fa', border: 'rgba(96,165,250,.35)' } };
    return m[s] || m.nodate;
  };

  const s = { body: { fontFamily: "'Segoe UI','Apple SD Gothic Neo',sans-serif", background: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)', minHeight: '100vh', padding: 24, color: '#fff' }, h1: { textAlign: 'center', fontSize: '1.85rem', marginBottom: 6 }, sub: { textAlign: 'center', color: '#aaa', marginBottom: 20, fontSize: '.88rem' } };

  return (
    <div style={s.body}>
      <h1 style={s.h1}>📚 한양대 LMS 과제 현황</h1>
      <p style={s.sub}>기준일: {new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Seoul' })}</p>

      {/* 쿠키 설정 */}
      <div style={{ background: 'rgba(255,255,255,.06)', borderRadius: 14, padding: '16px 20px', marginBottom: 20, border: '1px solid rgba(255,255,255,.1)' }}>
        <div style={{ fontSize: '.85rem', color: '#94a3b8', marginBottom: 8 }}>
          🔑 LMS 세션 쿠키 설정 {savedCookie ? <span style={{ color: '#4ade80', marginLeft: 8 }}>✓ 저장됨</span> : <span style={{ color: '#fb923c', marginLeft: 8 }}>미설정</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="password"
            placeholder="LMS 쿠키 값 입력 (xn_api_token=...)"
            value={cookie}
            onChange={e => setCookie(e.target.value)}
            style={{ flex: 1, minWidth: 200, background: 'rgba(0,0,0,.3)', border: '1px solid rgba(255,255,255,.2)', color: '#fff', padding: '8px 14px', borderRadius: 10, fontSize: '.84rem', outline: 'none' }}
          />
          <button onClick={saveCookie} style={{ background: 'rgba(99,102,241,.3)', border: '1px solid rgba(99,102,241,.5)', color: '#a5b4fc', padding: '8px 18px', borderRadius: 10, cursor: 'pointer', fontSize: '.84rem' }}>저장</button>
          <button onClick={fetchData} disabled={loading} style={{ background: 'rgba(96,165,250,.2)', border: '1px solid rgba(96,165,250,.4)', color: '#60a5fa', padding: '8px 18px', borderRadius: 10, cursor: 'pointer', fontSize: '.84rem', opacity: loading ? .5 : 1 }}>
            {loading ? '⏳ 로딩 중...' : '🔄 지금 갱신'}
          </button>
        </div>
        <div style={{ fontSize: '.75rem', color: '#64748b', marginTop: 8 }}>
          LMS 탭에서 F12 → Console → document.cookie 입력 후 나오는 값을 복사하여 붙여넣으세요.
        </div>
        {lastRefresh && <div style={{ fontSize: '.75rem', color: '#94a3b8', marginTop: 4 }}>마지막 갱신: {lastRefresh.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' })}</div>}
      </div>

      {/* 통계 */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
        {[['전체 과제', tot, '#60a5fa'], ['제출 완료', don, '#4ade80'], ['미제출', pen, '#fb923c'], ['기한 초과', ove, '#f87171']].map(([label, num, color]) => (
          <div key={label} style={{ background: 'rgba(255,255,255,.08)', borderRadius: 12, padding: '11px 20px', textAlign: 'center', border: '1px solid rgba(255,255,255,.12)', minWidth: 100 }}>
            <div style={{ fontSize: '1.85rem', fontWeight: 700, color }}>{num}</div>
            <div style={{ fontSize: '.74rem', color: '#bbb', marginTop: 3 }}>{label}</div>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {[['all','전체 보기'],['pending','미제출만'],['done','완료만'],['overdue','기한 초과'],['upcoming','D-7 이내']].map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} style={{ background: filter === f ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.08)', border: '1px solid ' + (filter === f ? 'rgba(255,255,255,.5)' : 'rgba(255,255,255,.2)'), color: '#fff', padding: '7px 16px', borderRadius: 20, cursor: 'pointer', fontSize: '.82rem' }}>{label}</button>
        ))}
      </div>

      {/* 과목별 과제 */}
      {assignments.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b' }}>🔑 위에서 LMS 쿠키를 설정하고 갱신 버튼을 눌러주세요.</div>
      )}
      {Object.keys(filtered).sort().map(cn => {
        const ca = courseMap[cn];
        const fa = filtered[cn];
        const sn = cn.replace(/^(\[.+?\])?\d{6}\w+_/, '');
        const done = ca.filter(a => a.submitted).length;
        const pct = ca.length ? Math.round(done / ca.length * 100) : 0;
        return (
          <div key={cn} style={{ background: 'rgba(255,255,255,.05)', borderRadius: 16, padding: 18, marginBottom: 16, border: '1px solid rgba(255,255,255,.1)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: '1rem', color: '#e2e8f0' }}>📖 {sn}</span>
              <span style={{ fontSize: '.78rem', color: '#94a3b8', background: 'rgba(255,255,255,.08)', padding: '3px 11px', borderRadius: 20 }}>{done}/{ca.length} 완료 ({pct}%)</span>
            </div>
            <div style={{ background: 'rgba(255,255,255,.1)', borderRadius: 4, height: 5, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 4, background: 'linear-gradient(90deg,#4ade80,#22c55e)', width: pct + '%' }} />
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
              <thead>
                <tr>{['과제명','상태','마감 / D-day'].map(h => <th key={h} style={{ padding: '7px 9px', textAlign: 'left', color: '#94a3b8', borderBottom: '1px solid rgba(255,255,255,.1)', fontSize: '.74rem', textTransform: 'uppercase' }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {fa.map(a => {
                  const st = getStatus(a);
                  const bs = a.workflow_state === 'graded' ? badgeStyle('graded') : badgeStyle(st);
                  const badgeLabel = a.workflow_state === 'graded' ? '채점완료' : st === 'done' ? '✓ 제출완료' : st === 'overdue' ? '⚠ 기한초과' : st === 'nodate' ? '마감없음' : '미제출';
                  const dd = ddayText(a);
                  const dl = getDeadline(a);
                  return (
                    <tr key={a.id} style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
                      <td style={{ padding: '10px 9px' }}>
                        <div style={{ fontWeight: 500, color: '#e2e8f0' }}>{a.name}</div>
                        <div style={{ fontSize: '.7rem', color: '#94a3b8', marginTop: 2 }}>{a.kind === 'discussion' ? '💬 토론' : a.submission_types.join(', ')}</div>
                      </td>
                      <td style={{ padding: '10px 9px' }}>
                        <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 12, fontSize: '.73rem', fontWeight: 600, background: bs.bg, color: bs.color, border: '1px solid ' + bs.border }}>{badgeLabel}</span>
                      </td>
                      <td style={{ padding: '10px 9px' }}>
                        <div style={{ fontWeight: 700, fontSize: '.88rem', color: ddayColors[dd.cls] }}>{dd.text}</div>
                        <div style={{ fontSize: '.74rem', color: '#94a3b8', marginTop: 2 }}>{fmtDate(dl)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
      <div style={{ textAlign: 'center', color: '#4a5568', fontSize: '.74rem', marginTop: 24, lineHeight: 1.8 }}>
        한양대학교 LMS 과제 현황 대시보드 · Vercel 배포
      </div>
    </div>
  );
}
