// 用紙設定（react-flow 版 paper-frame.tsx から描画部分を除いた型・寸法）

const MM = 96 / 25.4

export type PaperSize = 'A4' | 'B5' | 'A3'

export const PAPER_SIZES: Record<PaperSize, { w: number; h: number }> = {
	A4: { w: 210 * MM, h: 297 * MM },
	B5: { w: 182 * MM, h: 257 * MM },
	A3: { w: 297 * MM, h: 420 * MM },
}

export type PaperCfg = {
	on: boolean
	x: number
	y: number
	size: PaperSize
	landscape: boolean
	placed?: boolean
	ghost?: boolean
	/** 文書既定フォント（FONTS キー名 or カスタム書体名）。
	 *  用紙設定ではなく文書設定としてここに載せる（undo/保存/JSONの
	 *  全経路をこのオブジェクトが通るため） */
	font?: string
}

export const DEFAULT_PAPER: PaperCfg = {
	on: false,
	x: 0,
	y: 0,
	size: 'A4',
	landscape: false,
}

export function paperDims(cfg: PaperCfg): { w: number; h: number } {
	const s = PAPER_SIZES[cfg.size] ?? PAPER_SIZES.A4
	return cfg.landscape ? { w: s.h, h: s.w } : { w: s.w, h: s.h }
}
