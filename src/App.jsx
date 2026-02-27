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

const defaultFixedSchema = [
  { name: 'code', length: 13 },
  { name: 'plannedQty', length: 10 }
];

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error('CSVはヘッダー行＋データ行を入力してください');
  }

  const headers = lines[0].split(',').map((cell) => cell.trim());
  if (headers.some((header) => !header)) {
    throw new Error('CSVヘッダーに空の項目名があります');
  }

  return lines.slice(1).map((line, index) => {
    const values = line.split(',').map((cell) => cell.trim());
    if (values.length !== headers.length) {
      throw new Error(`CSV ${index + 2}行目の列数がヘッダーと一致しません`);
    }

    return headers.reduce((record, header, cellIndex) => {
      record[header] = values[cellIndex] ?? '';
      return record;
    }, {});
  });
}

export function parseFixedWidth(text, schema) {
  if (!Array.isArray(schema) || schema.length === 0) {
    throw new Error('項目を1つ以上設定してください');
  }

  const normalizedSchema = schema.map((column, index) => {
    const name = String(column?.name || '').trim();
    const length = Number(column?.length);

    if (!name) {
      throw new Error(`項目${index + 1}の項目名を入力してください`);
    }

    if (!Number.isInteger(length) || length <= 0) {
      throw new Error(`項目「${name}」の長さは1以上の整数で入力してください`);
    }

    return { name, length };
  });

  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return [];
  }

  const totalLength = normalizedSchema.reduce((sum, column) => sum + column.length, 0);

  return lines.map((line, lineIndex) => {
    if (line.length < totalLength) {
      throw new Error(
        `${lineIndex + 1}行目の行長不足です（必要: ${totalLength} / 実際: ${line.length}）`
      );
    }

    let start = 0;
    const record = {};

    normalizedSchema.forEach((column) => {
      const end = start + column.length;
      if (end > line.length) {
        throw new Error(
          `${lineIndex + 1}行目で「${column.name}」の項目長合計が行長を超えています`
        );
      }
      record[column.name] = line.substring(start, end).trim();
      start = end;
    });

    return record;
  });
}

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
  const [inputFormat, setInputFormat] = useState('csv');
  const [uploadFileName, setUploadFileName] = useState('');
  const [fixedSchema, setFixedSchema] = useState(defaultFixedSchema);
  const [fixedError, setFixedError] = useState('');
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

  const normalizePlanRows = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new Error('データが空です');
    }

    return rows.map((row, index) => {
      const code = String(row.code || row.品番 || row.col1 || '').trim();
      const plannedQty = Number(row.plannedQty || row.箱数 || row.col2);
      if (!code || !Number.isFinite(plannedQty) || plannedQty <= 0) {
        throw new Error(`行${index + 1}のデータが不正です（code/品番, plannedQty/箱数 を確認）`);
      }
      return { code, plannedQty };
    });
  };

  const applyPlan = async (normalized) => {
    const nextCounts = Object.fromEntries(normalized.map((item) => [item.code, 0]));
    setPlan(normalized);
    setCounts(nextCounts);
    setResult(initialResult);
    setPlanStatus(`ロード完了 (${normalized.length}件)`);
    await savePlan({ items: normalized, counts: nextCounts });
  };

  const handleLoadPlan = async () => {
    try {
      const parsed = JSON.parse(planText);
      if (!Array.isArray(parsed)) {
        throw new Error('JSONは配列形式で入力してください');
      }
      const normalized = normalizePlanRows(parsed);
      await applyPlan(normalized);
    } catch (error) {
      setPlanStatus(`ロード失敗: ${error.message}`);
    }
  };

  const handleFixedSchemaCountChange = (countValue) => {
    const count = Number(countValue);
    if (!Number.isInteger(count) || count <= 0) {
      setFixedError('項目数は1以上の整数で入力してください');
      return;
    }

    setFixedError('');
    setFixedSchema((current) => {
      if (count <= current.length) {
        return current.slice(0, count);
      }

      const appended = Array.from({ length: count - current.length }, (_, i) => ({
        name: `col${current.length + i + 1}`,
        length: 10
      }));
      return [...current, ...appended];
    });
  };

  const updateSchemaName = (index, name) => {
    setFixedSchema((current) =>
      current.map((column, columnIndex) =>
        columnIndex === index ? { ...column, name } : column
      )
    );
  };

  const updateSchemaLength = (index, length) => {
    setFixedSchema((current) =>
      current.map((column, columnIndex) =>
        columnIndex === index ? { ...column, length: Number(length) } : column
      )
    );
  };

  const handleInputFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadFileName(file.name);
    setPlanStatus('読み込み中...');
    setFixedError('');

    try {
      const text = await file.text();
      const rows = inputFormat === 'csv' ? parseCsv(text) : parseFixedWidth(text, fixedSchema);
      const normalized = normalizePlanRows(rows);
      await applyPlan(normalized);
    } catch (error) {
      if (inputFormat === 'fixed') {
        setFixedError(error.message);
      }
      setPlanStatus(`ロード失敗: ${error.message}`);
    } finally {
      event.target.value = '';
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
        <h2>1) 予定リスト事前ロード（入力フォーマット対応）</h2>

        <fieldset className="format-fieldset">
          <legend>入力形式：</legend>
          <label>
            <input
              type="radio"
              name="input-format"
              value="csv"
              checked={inputFormat === 'csv'}
              onChange={() => {
                setInputFormat('csv');
                setFixedError('');
              }}
            />
            CSV
          </label>
          <label>
            <input
              type="radio"
              name="input-format"
              value="fixed"
              checked={inputFormat === 'fixed'}
              onChange={() => {
                setInputFormat('fixed');
                setFixedError('');
              }}
            />
            固定長テキスト
          </label>
        </fieldset>

        <label className="file-picker-label">
          ファイルアップロード（.csv / .txt）
          <input type="file" accept=".csv,.txt,text/plain" onChange={handleInputFile} />
        </label>
        {uploadFileName && <p className="file-name">選択ファイル: {uploadFileName}</p>}

        {inputFormat === 'fixed' && (
          <div className="fixed-config">
            <h3>固定長設定</h3>
            <label>
              項目数
              <input
                type="number"
                min="1"
                value={fixedSchema.length}
                onChange={(e) => handleFixedSchemaCountChange(e.target.value)}
              />
            </label>

            <table>
              <thead>
                <tr>
                  <th>項目名</th>
                  <th>長さ</th>
                </tr>
              </thead>
              <tbody>
                {fixedSchema.map((column, index) => (
                  <tr key={`${column.name}-${index}`}>
                    <td>
                      <input
                        type="text"
                        value={column.name}
                        onChange={(e) => updateSchemaName(index, e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="1"
                        value={column.length}
                        onChange={(e) => updateSchemaLength(index, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">開始位置は項目長の累積値から自動計算されます。</p>
            {fixedError && <p className="error">固定長エラー: {fixedError}</p>}
          </div>
        )}

        <details>
          <summary>JSON手入力でロード（従来互換）</summary>
          <textarea
            value={planText}
            onChange={(e) => setPlanText(e.target.value)}
            rows={8}
            aria-label="予定リストJSON"
          />
          <button className="primary" onClick={handleLoadPlan}>予定リストを保存</button>
        </details>

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
