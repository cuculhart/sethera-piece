import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
	CSV_LIMITS,
	decodeCsvBytes,
	detectDelimiter,
	guessColTypes,
	guessHeader,
	parseDelimited,
	trimTable,
	type ColType,
	type ParsedTable,
} from './lib/csv'
import { useT } from './i18n'

const COL_TYPES: [ColType, string][] = [
	['text', 'テキスト'],
	['number', '数値'],
	['ignore', '無視'],
]

/** CSV/TSV の取込（貼り付け・ファイル）と書出（TSVコピー・CSV保存）。
 *  解析・プレビュー・列型指定はこのペイン内で完結させ、
 *  ピース生成とファイル出力は App 側のコールバックに渡す */
export function CsvPane({
	selCount,
	totalCount,
	onImport,
	onCopyTsv,
	onSaveCsv,
	onClose,
}: {
	/** 選択中の書出対象ピース数（piece/calc） */
	selCount: number
	/** 全文書の書出対象ピース数 */
	totalCount: number
	/** 取込実行。rows はヘッダー除去済み・行数制限適用済み */
	onImport: (rows: ParsedTable, colTypes: ColType[]) => void
	/** TSV をクリップボードへ。戻り値=書き出した行数 */
	onCopyTsv: (scope: 'sel' | 'all') => number
	/** CSV ファイルで保存。戻り値=書き出した行数 */
	onSaveCsv: (scope: 'sel' | 'all') => number
	onClose: () => void
}) {
	const t = useT()
	const [tab, setTab] = useState<'in' | 'out'>('in')
	const [raw, setRaw] = useState('')
	const [enc, setEnc] = useState('')
	const fileRef = useRef<HTMLInputElement>(null)

	// raw → 区切り自動判定 → パース → 空行/空列トリム
	const parsed = useMemo<ParsedTable>(() => {
		if (!raw.trim()) return []
		return trimTable(parseDelimited(raw, detectDelimiter(raw)))
	}, [raw])

	// 手動指定（未指定なら推定値を使う。parsed が変わったらリセット）
	const [headerOv, setHeaderOv] = useState<boolean | null>(null)
	const [typesOv, setTypesOv] = useState<ColType[] | null>(null)
	useEffect(() => {
		setHeaderOv(null)
		setTypesOv(null)
	}, [parsed])
	const headerGuess = useMemo(() => guessHeader(parsed), [parsed])
	const header = headerOv ?? headerGuess
	const types = useMemo(
		() =>
			(typesOv ?? guessColTypes(parsed, header)).map((t, ci) =>
				ci >= CSV_LIMITS.cols ? 'ignore' : t
			),
		[typesOv, parsed, header]
	)

	const dataRows = useMemo(
		() => (header ? parsed.slice(1) : parsed),
		[parsed, header]
	)
	const usedCols = types.filter((t) => t !== 'ignore').length
	// 生成ピース上限を超えないよう取込行数をクランプ。
	// 実際にピース化されるセル数（非空・非無視列）の累計で数えるので、
	// 空セルの多い表でも最悪ケース換算より多く取り込める
	const { importRows, pieceCount } = useMemo(() => {
		let n = 0
		const out: ParsedTable = []
		for (const r of dataRows.slice(0, CSV_LIMITS.rows)) {
			const cells = types.reduce(
				(a, t, ci) =>
					a + (t !== 'ignore' && (r[ci] ?? '').trim() !== '' ? 1 : 0),
				0
			)
			if (n + cells > CSV_LIMITS.pieces) break
			n += cells
			out.push(r)
		}
		return { importRows: out, pieceCount: n }
	}, [dataRows, types])
	const truncated = dataRows.length > importRows.length
	const tooManyCols = parsed.some((r) => r.length > CSV_LIMITS.cols)

	const onFile = (e: ChangeEvent<HTMLInputElement>) => {
		const f = e.currentTarget.files?.[0]
		e.currentTarget.value = ''
		if (!f) return
		if (f.size > CSV_LIMITS.fileBytes) {
			alert(
				t('ファイルが大きすぎます（{mb}MB まで）', {
					mb: CSV_LIMITS.fileBytes / 1024 / 1024,
				})
			)
			return
		}
		f.arrayBuffer().then((buf) => {
			const d = decodeCsvBytes(buf)
			setRaw(d.text)
			setEnc(d.enc)
		})
	}

	// ─── 書出側 ───
	const [scope, setScope] = useState<'sel' | 'all'>(
		selCount > 0 ? 'sel' : 'all'
	)
	const [outMsg, setOutMsg] = useState('')

	const previewRows = dataRows.slice(0, 6)

	return (
		<>
			<h2>CSV / TSV</h2>
			<div className="csv-tabs">
				<button
					className={tab === 'in' ? 'active' : ''}
					onClick={() => setTab('in')}
				>
					{t('取込')}
				</button>
				<button
					className={tab === 'out' ? 'active' : ''}
					onClick={() => setTab('out')}
				>
					{t('書出')}
				</button>
			</div>
			{tab === 'in' ? (
				<>
					<p className="modal-sub">
						{t(
							'Excel の範囲コピー（TSV）を貼り付けるか、CSV ファイルを選択してください（UTF-8 / UTF-16 / Shift_JIS / EUC-JP 自動判定）'
						)}
					</p>
					<textarea
						className="csv-src"
						name="csv-src"
						placeholder={t('ここに貼り付け（例: 品名<TAB>数量<TAB>単価）')}
						value={raw}
						onChange={(e) => setRaw(e.currentTarget.value)}
						rows={5}
					/>
					<div className="csv-src-actions">
						<button onClick={() => fileRef.current?.click()}>
							{t('CSV ファイルを選択…')}
						</button>
						{enc && (
							<span className="insp-hint">
								{t('文字コード: {e}', { e: enc })}
							</span>
						)}
						<input
							ref={fileRef}
							type="file"
							name="csv-file"
							accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
							style={{ display: 'none' }}
							onChange={onFile}
						/>
					</div>
					{parsed.length > 0 && (
						<>
							<div className="csv-opts">
								<label>
									<input
										type="checkbox"
										name="csv-header"
										checked={header}
										onChange={(e) =>
											setHeaderOv(e.target.checked)
										}
									/>
									{t('1行目はヘッダー（取り込まない）')}
								</label>
								<span className="insp-hint">
									{t('{r} 行 × {c} 列（{p} ピース）', {
										r: dataRows.length,
										c: types.length,
										p: pieceCount,
									})}
								</span>
							</div>
							<div className="csv-preview-wrap">
								<table className="csv-preview">
									<thead>
										<tr>
											{types.map((ct, ci) => (
												<th key={ci}>
													<select
														className="insp-select"
														name={`csv-col-${ci}`}
														value={ct}
														disabled={
															ci >= CSV_LIMITS.cols
														}
														onChange={(e) => {
															const nt = [
																...types,
															]
															nt[ci] =
																e.target
																	.value as ColType
															setTypesOv(nt)
														}}
													>
														{COL_TYPES.map(
															([v, l]) => (
																<option
																	key={v}
																	value={v}
																>
																	{t(l)}
																</option>
															)
														)}
													</select>
												</th>
											))}
										</tr>
									</thead>
									<tbody>
										{previewRows.map((r, ri) => (
											<tr key={ri}>
												{types.map((_, ci) => (
													<td key={ci}>
														{r[ci] ?? ''}
													</td>
												))}
											</tr>
										))}
									</tbody>
								</table>
							</div>
							{dataRows.length > previewRows.length && (
								<p className="insp-hint">
									{t('…他 {n} 行', {
										n: dataRows.length - previewRows.length,
									})}
								</p>
							)}
							{(truncated || tooManyCols) && (
								<p className="csv-warn">
									{tooManyCols &&
										t(
											'{c} 列を超える列は「無視」として扱います。',
											{ c: CSV_LIMITS.cols }
										)}
									{truncated &&
										t('上限のため先頭 {n} 行まで取り込みます。', {
											n: importRows.length,
										})}
								</p>
							)}
						</>
					)}
					<div className="modal-actions">
						<button onClick={onClose}>{t('閉じる')}</button>
						<button
							disabled={!importRows.length || usedCols === 0}
							onClick={() => {
								onImport(importRows, types)
								onClose()
							}}
						>
							{t('{n} 行を取り込む', { n: importRows.length })}
						</button>
					</div>
				</>
			) : (
				<>
					<p className="modal-sub">
						{t(
							'ピースの配置どおりに行列を再構成して書き出します（計算ピースは計算結果の値。罫線・ゾーンは除外）'
						)}
					</p>
					<div className="csv-opts">
						<label>
							<input
								type="radio"
								name="csv-scope"
								checked={scope === 'sel'}
								disabled={selCount === 0}
								onChange={() => setScope('sel')}
							/>
							{t('選択中のピース（{n}）', { n: selCount })}
						</label>
						<label>
							<input
								type="radio"
								name="csv-scope"
								checked={scope === 'all'}
								onChange={() => setScope('all')}
							/>
							{t('文書全体（{n}）', { n: totalCount })}
						</label>
					</div>
					<div className="modal-actions">
						{outMsg && (
							<span className="insp-hint">{outMsg}</span>
						)}
						<button onClick={onClose}>{t('閉じる')}</button>
						<button
							onClick={() =>
								setOutMsg(
									t(
										'{n} 行をクリップボードにコピーしました（Excel にそのまま貼り付けられます）',
										{ n: onCopyTsv(scope) }
									)
								)
							}
						>
							{t('TSV をコピー')}
						</button>
						<button
							onClick={() =>
								setOutMsg(
									t('{n} 行を CSV で保存しました', {
										n: onSaveCsv(scope),
									})
								)
							}
						>
							{t('CSV で保存')}
						</button>
					</div>
				</>
			)}
		</>
	)
}
