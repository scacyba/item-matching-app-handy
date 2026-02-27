# 段ボール検品アプリ（Panasonic業務端末向け）

## 1. 画面構成

1. **予定リスト事前ロード**
   - ホスト連携JSONを貼り付け/読み込み
   - `予定リストを保存` でIndexedDBに保存
2. **検品スキャン**
   - スキャナ入力（キーボード入力）を受ける入力欄
   - Enter受信で即時判定
   - OK（緑）/NG（赤）/完了表示
3. **進捗表示**
   - 品番ごとの `スキャン数 / 予定箱数`
   - 予定数到達で行を完了色に変更

## 2. データモデル

### 予定リスト（host JSON）

```json
[
  { "code": "4901234567890", "plannedQty": 10 },
  { "code": "4909999999999", "plannedQty": 10 }
]
```

- `code`: 品番（バーコード文字列）
- `plannedQty`: 予定箱数

`品番` / `箱数` キーでも取り込み可能です。

### IndexedDB保存形式

```json
{
  "items": [{ "code": "4901234567890", "plannedQty": 10 }],
  "counts": { "4901234567890": 3 }
}
```

## 3. スキャン入力処理

- Panasonic内蔵スキャナの「キーボードウェッジ」出力を想定
- 入力欄にフォーカスを維持し、Enterで1件確定
- 判定ロジック:
  - 予定に存在 -> `OK`（緑） + 高音ビープ
  - 予定外 -> `NG`（赤） + 低音ビープ
- 同一品番を加算し、`plannedQty` 到達で `完了` 表示

## 4. React実装（完全コード）

主要コードは以下です。

- `src/App.jsx`: 画面・判定・カウント・音・完了判定
- `src/db.js`: IndexedDB保存/読込
- `src/main.jsx`: 起動とService Worker登録
- `public/sw.js`: オフラインキャッシュ
- `public/manifest.webmanifest`: PWA設定
- `src/styles.css`: 手袋操作向け大型UI

## 開発手順

```bash
npm install
npm run dev
```

## PWAビルド

```bash
npm run build
npm run preview
```
