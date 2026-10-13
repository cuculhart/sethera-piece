import { useState } from 'react'
import { FONTS, missingFonts } from './lib/fonts'
import { useT } from './i18n'

/** フォント選択UI（文書既定・ピース共通）。
 *  FONTS の同梱書体 + 「カスタム…」自由入力。カスタム書体名が
 *  環境に未インストールなら ⚠ を表示する（表示側はフォールバックで読める） */
export function FontSelect({
	id,
	value,
	onPick,
	allowInherit = false,
}: {
	id?: string
	/** 現在値。'' = 文書既定（allowInherit 時）、FONTS キー、またはカスタム名 */
	value: string
	onPick: (f: string) => void
	/** 「文書既定」選択肢を出すか（ピース側のみ true） */
	allowInherit?: boolean
}) {
	const t = useT()
	const isCustom = !!value && !FONTS.some((f) => f.key === value)
	// セレクトの表示モード。null=値から導出（カスタムを選んだ直後の
	// 未入力状態を保持するためのローカルモード）
	const [mode, setMode] = useState<string | null>(null)
	const [draft, setDraft] = useState(isCustom ? value : '')
	const selValue = mode ?? (isCustom ? '__custom' : value)
	const customOpen = selValue === '__custom'
	const commit = () => {
		const v = draft.trim()
		if (v && v !== value) onPick(v)
	}
	const draftMissing =
		customOpen && draft.trim() !== '' && missingFonts([draft]).length > 0

	return (
		<>
			<select
				id={id}
				className="insp-select"
				value={selValue}
				onChange={(e) => {
					const v = e.currentTarget.value
					setMode(v === '__custom' ? '__custom' : null)
					if (v !== '__custom') onPick(v)
					else if (draft.trim()) onPick(draft.trim())
				}}
			>
				{allowInherit && <option value="">{t('文書既定')}</option>}
				{FONTS.map((f) => (
					<option
						key={f.key}
						value={f.key}
						style={{ fontFamily: f.stack }}
					>
						{t(f.label)}
					</option>
				))}
				<option value="__custom">{t('カスタム…')}</option>
			</select>
			{customOpen && (
				<>
					<input
						className="insp-text"
						value={draft}
						placeholder={t('フォント名（例: Meiryo）')}
						onChange={(e) => setDraft(e.currentTarget.value)}
						onBlur={commit}
						onKeyDown={(e) => {
							if (e.key === 'Enter') commit()
						}}
					/>
					{draftMissing && (
						<span
							className="insp-hint"
							title={t(
								'この環境にインストールされていないフォントです。既定フォントで表示されます'
							)}
						>
							{t('⚠ 未所持')}
						</span>
					)}
				</>
			)}
		</>
	)
}
