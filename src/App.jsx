import { useEffect, useMemo, useRef, useState } from 'react';
import { loadPlan, savePlan } from './db';

const initialResult = {
  status: 'idle',
  message: 'スキャン待機中',
  code: ''
};

const defaultPlanText = JSON.stringify(
  [
    { code: '4901234567890', plannedQty: 10 },
    { code: '4909999999999', plannedQty: 10 }
  ],
  null,
  2
);

function playBeep(type) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.value = type === 'ok' ? 880 : 240;
  gain.gain.value = 0.08;

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.12);

  oscillator.onended = () => context.close();
}

export default function App() {
  const [planText, setPlanText] = useState(defaultPlanText);
  const [plan, setPlan] = useState([]);
  const [counts, setCounts] = useState({});
  const [result, setResult] = useState(initialResult);
  const [inputValue, setInputValue] = useState('');
  const [planStatus, setPlanStatus] = useState('未ロード');
  const inputRef = useRef(null);

  useEffect(() => {
    (async () => {
      const stored = await loadPlan();
      if (stored?.items?.length) {
        setPlan(stored.items);
        setCounts(stored.counts || {});
        setPlanText(JSON.stringify(stored.items, null, 2));
        setPlanStatus(`ローカル読込済み (${stored.items.length}件)`);
      }
    })().catch((error) => {
      console.error(error);
      setPlanStatus('ローカル読込失敗');
    });
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const planMap = useMemo(() => {
    return new Map(plan.map((item) => [item.code, item]));
  }, [plan]);

  const completion = useMemo(() => {
    return plan.map((item) => {
      const scanned = counts[item.code] || 0;
      return {
        ...item,
        scanned,
        done: scanned >= item.plannedQty
      };
    });
  }, [plan, counts]);

  const allComplete = completion.length > 0 && completion.every((item) => item.done);

  const handleLoadPlan = async () => {
    try {
      const parsed = JSON.parse(planText);
      if (!Array.isArray(parsed)) {
        throw new Error('JSONは配列形式で入力してください');
      }

      const normalized = parsed.map((row, index) => {
        const code = String(row.code || row.品番 || '').trim();
        const plannedQty = Number(row.plannedQty || row.箱数);
        if (!code || !Number.isFinite(plannedQty) || plannedQty <= 0) {
          throw new Error(`行${index + 1}のデータが不正です`);
        }
        return { code, plannedQty };
      });

      const nextCounts = Object.fromEntries(normalized.map((item) => [item.code, 0]));
      setPlan(normalized);
      setCounts(nextCounts);
      setResult(initialResult);
      setPlanStatus(`ロード完了 (${normalized.length}件)`);
      await savePlan({ items: normalized, counts: nextCounts });
    } catch (error) {
      setPlanStatus(`ロード失敗: ${error.message}`);
    }
  };

  const judgeScan = async (rawCode) => {
    const code = rawCode.trim();
    if (!code) return;

    if (planMap.has(code)) {
      const expected = planMap.get(code);
      const nextCounts = {
        ...counts,
        [code]: (counts[code] || 0) + 1
      };
      setCounts(nextCounts);
      const done = nextCounts[code] >= expected.plannedQty;
      setResult({
        status: 'ok',
        message: done ? `完了: ${code}` : `OK: ${code}`,
        code
      });
      playBeep('ok');
      await savePlan({ items: plan, counts: nextCounts });
    } else {
      setResult({
        status: 'ng',
        message: `NG: ${code} は予定外`,
        code
      });
      playBeep('ng');
    }
  };

  const handleScanKeyDown = async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      const code = inputValue;
      setInputValue('');
      await judgeScan(code);
    }
  };

  const resultClass = result.status === 'ok' ? 'result ok' : result.status === 'ng' ? 'result ng' : 'result';

  return (
    <main className="app" onClick={() => inputRef.current?.focus()}>
      <h1>段ボール検品アプリ</h1>

      <section className="panel">
        <h2>1) 予定リスト事前ロード（JSON）</h2>
        <textarea
          value={planText}
          onChange={(e) => setPlanText(e.target.value)}
          rows={8}
          aria-label="予定リストJSON"
        />
        <button className="primary" onClick={handleLoadPlan}>予定リストを保存</button>
        <p className="status">状態: {planStatus}</p>
      </section>

      <section className="panel">
        <h2>2) 検品スキャン</h2>
        <input
          ref={inputRef}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleScanKeyDown}
          className="scanner"
          placeholder="バーコード入力（スキャンで自動入力）"
          inputMode="numeric"
        />
        <div className={resultClass}>{result.message}</div>
        {allComplete && <div className="complete-banner">全品番の検品が完了しました</div>}
      </section>

      <section className="panel">
        <h2>3) 進捗（10箱単位）</h2>
        <ul>
          {completion.map((item) => (
            <li key={item.code} className={item.done ? 'done' : ''}>
              <span>{item.code}</span>
              <strong>{item.scanned} / {item.plannedQty}</strong>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
