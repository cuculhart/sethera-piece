# sethera-v2 移植 TODO

react-flow 版 sethera（`../sethera`、約 7,300 行）→ kimetron 版（`app/`）の本格移植チェックリスト。
進捗は実装と同期して更新する。

## 設計メモ（落とし穴）

- **kind 衝突**: エンジン `isShapeKind` は `'line'/'curve'/'ellipse'/'arc'/'polygon'` を
  ストローク近接ヒット＋エンジン描画として扱う（`renderObject` が呼ばれない、
  bbox ヒットにならない）。sethera オブジェクトは RF 版と同じ bbox ヒット＋
  自前 SVG 描画にするため、内部 kind は **`piece` / `zone` / `calc` / `stroke` / `spline`** を使う。
- **ゾーンのヒット/マーキー除外**: 同梱エンジンに `hitFilter`（クリックヒット）と
  `marqueeFilter`（矩形選択）フックを追加。zone kind は両方で除外（ボディはクリックスルー）、
  ヘッダーは App 側のキャプチャハンドラで選択・ドラッグを独自処理（Shift 追加選択も対応）。
  線編集モードでは hitFilter/marqueeFilter を stroke のみに絞る。
- **吸着 OFF**: オブジェクトスナップはエンジンで常時ON。同梱エンジンに `snapObjects` フラグ
  （既定 true）を追加し、OFF 時は grid.snap と合わせて無効化。
- **ライブ更新と undo**: `engine.setDoc` は1回=1 undo エントリ。同梱エンジンに
  `patchDoc`（履歴なしライブ更新）/ `commitDoc`（確定1 undo）を追加し、
  紙ドラッグ・ゾーンヘッダードラッグ・曲線頂点ドラッグ・矢印キー連打は
  「patchDoc 中間表示 → pointerup/keyup で commitDoc」パターンにする。
- **曲線頂点**: `data.pts` は px ではなく正規化座標 `{fx,fy}`（bbox 0..1）で保持し、
  エンジンリサイズに追従。JSON 書き出し時に px へ逆変換（旧フォーマット互換）。
- **永続化形式**: localStorage `sethera-doc`・`sethera-templates`・JSON エクスポートは
  旧 sethera（nodes/edges 形式）を維持し、lib/docio.ts で相互変換。旧ファイル・テンプレを開ける。

## 実装

- [x] 依存追加（@fontsource 3種・html-to-image）+ 無変更コピー（aggregate/fonts/i18n/en/styles/font-select/hint-context/csv-pane 土台）
- [x] types.ts（データ型 + 旧 SNode/SEdge 形式）/ colors.ts（パレット・線種定数）
- [x] lib/calc.ts → objectValue/zoneMembers/memberMatch/zonePartialIds/operandSource/numFmtOf/numCls
- [x] lib/csv.ts → gridCsv を objects/edges 対応に改修 / lib/templates.ts（旧キー・旧形式維持）
- [x] lib/docio.ts — nodes↔objects / edges↔SEdge 相互変換、JSON 保存/読込、doc→SNode 変換
- [x] model.ts — ポート定義・WIRE_DEFAULTS・canConnect/connectOrient/connectReplace/rewirePickup・オブジェクトファクトリ
- [x] parts.tsx — renderObject 実装（piece/zone/calc/stroke/spline + ピース inline 編集 + ゾーンチップ + calc オペランド + 曲線頂点編集）
- [x] 同梱エンジン最小拡張 — `hitFilter`/`marqueeFilter` フック + `snapObjects` フラグ + `patchDoc`/`commitDoc` + `snapExtra`
- [x] inspector.tsx — objects 版に移植（applyData/applyNode → doc 書き込み、o.group/o.locked ネイティブ使用）
- [x] paper-frame.tsx — 用紙タグ UI（サイズ/向き/ghost/ドラッグ、スクリーン座標オーバーレイ）＋ .ki-page ghost CSS
- [x] App.tsx — エンジン配線 + ツールバー全項目 + モーダル + キーボード + 描画モード（ゾーン/曲線オーバーレイ）+ 印刷 + 永続化 + テーマ + i18n
- [x] styles.css — kimetron キャンバス向け調整（.ki-obj 中立化・.ki-port・.ki-page・.ki-marquee・テーマ変数）
- [x] csv-pane.tsx — 原本準拠 IF（selCount/totalCount/onImport/onCopyTsv/onSaveCsv/onClose）

## 既知の機能差分（v1 で許容するもの）

- エンジンリサイズの最小サイズはグローバル MIN（種別ごとの最小は inspector 側でクランプ）
- ポートの不透明度は全体一律 .4→hover 1（旧版はノード hover 時のみ不透明度1）
- 矢印キー微移動は patchDoc+keyup で1 undo（旧版は drag イベント累積だが同等）
- ゾーンボディ上クリックはマーキー＝全選択解除（旧版の pane クリック解除と同等の挙動）

## 検証

- [x] `npm run typecheck` 全ワークスペース ✅
- [x] `npm run build` ✅
- [ ] dev サーバーで手動確認（作成/編集/接続/ゾーン/計算/グループ/ロック/複製/CSV/テンプレ/用紙/印刷/保存/言語/テーマ）
- [ ] ユーザー確認後にコミット（push しない・remote 未設定のまま）
