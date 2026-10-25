/** フォント選択肢と解決。
 *  同梱フォント=保証付き推奨／自由入力=警告付き許可（backlog B3 方針）。
 *  カスタム書体は未所持でもスタック末尾の既定にフォールバックする */

export type FontKey = 'sans' | 'mincho' | 'biz' | 'mono'

export const DEFAULT_FONT_KEY: FontKey = 'sans'

export const FONTS: { key: FontKey; label: string; stack: string }[] = [
	{
		key: 'sans',
		label: 'ゴシック',
		stack:
			"'Noto Sans JP', 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', sans-serif",
	},
	{
		key: 'mincho',
		label: '明朝',
		stack:
			"'Shippori Mincho', 'Hiragino Mincho ProN', 'Yu Mincho', 'MS PMincho', serif",
	},
	{
		key: 'biz',
		label: '帳票ゴシック',
		stack: "'BIZ UDPGothic', 'BIZ UDGothic', 'Meiryo UI', 'Noto Sans JP', sans-serif",
	},
	{
		key: 'mono',
		label: '等幅',
		stack: "ui-monospace, 'Cascadia Mono', Consolas, 'MS Gothic', monospace",
	},
]

const STACK_BY_KEY = new Map<string, string>(
	FONTS.map((f) => [f.key, f.stack])
)

/** font 指定（FONTS キー名 or カスタム書体名）を CSS font-family に解決。
 *  ピース指定 → 文書既定 → 既定ゴシックの優先順。
 *  カスタム名は引用符を除去して先頭に置き、末尾に既定スタックを
 *  フォールバックとして連結する（未所持でも文字は読める） */
export function fontStack(
	pieceFont: string | undefined,
	docFont: string | undefined
): string | undefined {
	const spec = pieceFont ?? docFont
	if (!spec) return undefined
	const known = STACK_BY_KEY.get(spec)
	if (known) return known
	return `'${spec.replace(/'/g, '')}', ${STACK_BY_KEY.get(DEFAULT_FONT_KEY)}`
}

/** カスタム書体名（FONTS キー以外）のうち環境に未インストールのものを列挙。
 *  document.fonts.check で判定。未対応環境では空配列（警告しない） */
export function missingFonts(specs: (string | undefined)[]): string[] {
	if (typeof document === 'undefined' || !document.fonts?.check) return []
	const customs = new Set(
		specs.filter((s): s is string => !!s && !STACK_BY_KEY.has(s))
	)
	return [...customs].filter(
		(s) => !document.fonts.check(`12px "${s.replace(/"/g, '')}"`)
	)
}
