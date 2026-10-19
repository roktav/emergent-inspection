#!/usr/bin/env python3
"""Build the ITI-branded customer deck (16:9).

Bahasa Indonesia titles, one English subtitle each. Screenshots are from
the pre-production site and live in images/intro/.

Rebuild:
    python3 docs/panduan-pengguna/build_intro_pptx.py

Visual tokens match print.css: ink #231915, accent #98A7D5, tint #D6D2E9,
paper white. Headings Poppins SemiBold, body Roboto — family names are set
even if the presenting PC lacks the files (same approach as the PDF).
"""
from __future__ import annotations

from pathlib import Path

from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parent
IMAGES = ROOT / "images"
INTRO = IMAGES / "intro"
LOGO = IMAGES / "brand" / "logo.png"
OUT = ROOT.parent / "Inspeksi_Aset_Pengenalan.pptx"

SLIDE_W = Inches(13.333)
SLIDE_H = Inches(7.5)

INK = RGBColor(0x23, 0x19, 0x15)
ACCENT = RGBColor(0x98, 0xA7, 0xD5)
TINT = RGBColor(0xD6, 0xD2, 0xE9)
PAPER = RGBColor(0xFF, 0xFF, 0xFF)
MUTED = RGBColor(0x5C, 0x56, 0x62)

FONT_HEAD = "Poppins"
FONT_BODY = "Roboto"

MARGIN_X = Inches(0.55)
FOOTER_Y = Inches(7.12)


def set_run_font(run, name: str, size_pt: float, *, bold=False, color=INK):
    run.font.name = name
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run.font.color.rgb = color
    rPr = run._r.get_or_add_rPr()
    for tag in ("latin", "ea", "cs"):
        el = rPr.find(qn(f"a:{tag}"))
        if el is None:
            el = etree.SubElement(rPr, qn(f"a:{tag}"))
        el.set("typeface", name)


def no_line(shape):
    shape.line.fill.background()


def set_slide_bg(slide, color: RGBColor):
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def add_rect(slide, left, top, width, height, fill: RGBColor, *, rounded=False):
    kind = MSO_SHAPE.ROUNDED_RECTANGLE if rounded else MSO_SHAPE.RECTANGLE
    shape = slide.shapes.add_shape(kind, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    no_line(shape)
    if rounded:
        try:
            shape.adjustments[0] = 0.08
        except Exception:
            pass
    return shape


def add_oval(slide, left, top, size, fill: RGBColor):
    shape = slide.shapes.add_shape(MSO_SHAPE.OVAL, left, top, size, size)
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    no_line(shape)
    return shape


def add_textbox(slide, left, top, width, height):
    return slide.shapes.add_textbox(left, top, width, height)


def write_para(tf, text, *, size, font=FONT_BODY, bold=False, color=INK, align=PP_ALIGN.LEFT, space_after=6, space_before=0, first=False):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    p.space_after = Pt(space_after)
    p.space_before = Pt(space_before)
    run = p.add_run()
    run.text = text
    set_run_font(run, font, size, bold=bold, color=color)
    return p


def write_mixed(tf, parts, *, size, font=FONT_BODY, color=INK, align=PP_ALIGN.LEFT, space_after=8, first=False):
    """parts: list of (text, bold)."""
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    p.space_after = Pt(space_after)
    p.space_before = Pt(0)
    for text, bold in parts:
        run = p.add_run()
        run.text = text
        set_run_font(run, font, size, bold=bold, color=color)
    return p


def add_notes(slide, text: str):
    notes = slide.notes_slide
    notes.notes_text_frame.text = text


def picture_size(path: Path, box_w, box_h):
    with Image.open(path) as im:
        iw, ih = im.size
    ar = iw / ih
    box_ar = box_w / box_h
    if ar > box_ar:
        w = box_w
        h = int(box_w / ar)
    else:
        h = box_h
        w = int(box_h * ar)
    return w, h


def add_logo(slide, left, top, height):
    with Image.open(LOGO) as im:
        iw, ih = im.size
    width = int(height * (iw / ih))
    return slide.shapes.add_picture(str(LOGO), left, top, width=width, height=height)


def add_framed_shot(slide, path: Path, left, top, width, max_height, *, pad=Inches(0.08)):
    """Fit the bitmap at its native aspect, then vertically center in max_height."""
    inner_w = width - pad * 2
    pw, ph = picture_size(path, inner_w, max_height - pad * 2)
    height = ph + pad * 2
    if height > max_height:
        height = max_height
        pw, ph = picture_size(path, inner_w, max_height - pad * 2)
    top = top + (max_height - height) // 2
    add_rect(slide, left, top, width, height, TINT, rounded=True)
    px = left + pad + (inner_w - pw) // 2
    py = top + pad
    slide.shapes.add_picture(str(path), px, py, width=pw, height=ph)


def add_inner_chrome(slide, number: int, total: int, kicker_text: str = "Pengenalan  ·  Inspeksi Aset"):
    set_slide_bg(slide, PAPER)
    logo = add_logo(slide, MARGIN_X, Inches(0.22), Inches(0.42))
    kicker = add_textbox(slide, logo.left + logo.width + Inches(0.22), Inches(0.28), Inches(7.5), Inches(0.32))
    tf = kicker.text_frame
    tf.word_wrap = False
    write_para(
        tf,
        kicker_text,
        size=11,
        font=FONT_HEAD,
        bold=True,
        color=MUTED,
        first=True,
        space_after=0,
    )
    add_rect(slide, MARGIN_X, Inches(0.74), SLIDE_W - MARGIN_X * 2, Pt(2), ACCENT)
    foot_l = add_textbox(slide, MARGIN_X, FOOTER_Y, Inches(9.5), Inches(0.28))
    tf = foot_l.text_frame
    write_para(
        tf,
        "Inline Technology International",
        size=10,
        font=FONT_BODY,
        color=MUTED,
        first=True,
        space_after=0,
    )
    foot_r = add_textbox(slide, Inches(11.2), FOOTER_Y, Inches(1.55), Inches(0.28))
    tf = foot_r.text_frame
    write_para(
        tf,
        f"{number}  /  {total}",
        size=10,
        font=FONT_BODY,
        color=MUTED,
        align=PP_ALIGN.RIGHT,
        first=True,
        space_after=0,
    )


def style_table(table, rows, col_widths):
    table.first_row = False
    table.horz_banding = False
    for i, w in enumerate(col_widths):
        table.columns[i].width = w
    for r, row in enumerate(rows):
        for c, text in enumerate(row):
            cell = table.cell(r, c)
            cell.text = ""
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.margin_left = Inches(0.14)
            cell.margin_right = Inches(0.12)
            cell.margin_top = Inches(0.08)
            cell.margin_bottom = Inches(0.08)
            fill = INK if r == 0 else (TINT if r % 2 == 0 else PAPER)
            cell.fill.solid()
            cell.fill.fore_color.rgb = fill
            tf = cell.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.alignment = PP_ALIGN.LEFT
            run = p.add_run()
            run.text = text
            color = PAPER if r == 0 else INK
            set_run_font(
                run,
                FONT_HEAD if (r == 0 or c == 0) else FONT_BODY,
                13 if r == 0 else 14,
                bold=(r == 0 or c == 0),
                color=color,
            )


def add_title(slide, text: str, subtitle: str = "", *, top=Inches(0.84), size=24):
    box = add_textbox(slide, MARGIN_X, top, Inches(12.2), Inches(0.78))
    tf = box.text_frame
    tf.word_wrap = True
    write_para(tf, text, size=size, font=FONT_HEAD, bold=True, color=INK, first=True, space_after=1)
    if subtitle:
        write_para(tf, subtitle, size=13, font=FONT_BODY, color=MUTED, space_after=0)
    return box


def add_bullets(slide, left, top, width, height, items, *, size=16, space_after=10):
    box = add_textbox(slide, left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        if isinstance(item, list):
            write_mixed(tf, item, size=size, first=(i == 0), space_after=space_after)
        else:
            write_para(tf, item, size=size, first=(i == 0), space_after=space_after)
    return box


def add_card(slide, left, top, width, height, kicker: str, body: str):
    add_rect(slide, left, top, width, height, TINT, rounded=True)
    k = add_textbox(slide, left + Inches(0.18), top + Inches(0.14), width - Inches(0.32), Inches(0.32))
    tf = k.text_frame
    write_para(tf, kicker, size=11, font=FONT_HEAD, bold=True, color=INK, first=True, space_after=0)
    b = add_textbox(slide, left + Inches(0.18), top + Inches(0.46), width - Inches(0.32), height - Inches(0.58))
    tf = b.text_frame
    tf.word_wrap = True
    write_para(tf, body, size=13, color=INK, first=True, space_after=0)


def new_prs() -> Presentation:
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    return prs


def blank(prs: Presentation):
    return prs.slides.add_slide(prs.slide_layouts[6])


TOTAL = 13
BODY_TOP = Inches(1.72)
SHOT_LEFT = Inches(6.85)
SHOT_W = Inches(5.9)
SHOT_H = Inches(5.05)


def slide_cover(prs: Presentation):
    slide = blank(prs)
    set_slide_bg(slide, INK)

    grid_left = Inches(9.35)
    grid_top = Inches(1.55)
    cell = Inches(1.12)
    gap = Inches(0.22)
    size = Inches(0.9)
    for r in range(3):
        for c in range(3):
            idx = r * 3 + c
            fill = TINT if (idx % 3 == 1) else ACCENT
            add_oval(slide, grid_left + c * (cell + gap), grid_top + r * (cell + gap), size, fill)

    plate = add_rect(slide, MARGIN_X, Inches(0.42), Inches(4.35), Inches(1.35), PAPER, rounded=True)
    add_logo(slide, plate.left + Inches(0.28), plate.top + Inches(0.28), Inches(0.78))

    kicker = add_textbox(slide, MARGIN_X, Inches(2.15), Inches(8.4), Inches(0.36))
    tf = kicker.text_frame
    write_para(tf, "PENGENALAN UNTUK PELANGGAN", size=12, font=FONT_HEAD, bold=True, color=TINT, first=True, space_after=0)

    title = add_textbox(slide, MARGIN_X, Inches(2.52), Inches(8.6), Inches(1.05))
    tf = title.text_frame
    tf.word_wrap = True
    write_para(tf, "Inspeksi Aset", size=44, font=FONT_HEAD, bold=True, color=PAPER, first=True, space_after=0)

    product = add_textbox(slide, MARGIN_X, Inches(3.62), Inches(8.6), Inches(0.85))
    tf = product.text_frame
    tf.word_wrap = True
    write_para(tf, "Asset Inspection", size=20, font=FONT_HEAD, bold=True, color=ACCENT, first=True, space_after=2)
    write_para(tf, "Checklist walk-around digital untuk dump truck", size=16, color=TINT, space_after=0)

    add_rect(slide, MARGIN_X, Inches(4.62), Inches(1.65), Pt(2.5), ACCENT)

    meta = add_textbox(slide, MARGIN_X, Inches(4.9), Inches(8.4), Inches(1.3))
    tf = meta.text_frame
    tf.word_wrap = True
    write_para(tf, "Inline Technology International", size=16, font=FONT_BODY, color=TINT, first=True, space_after=4)
    write_para(tf, "15 Oktober 2026  ·  untuk pelanggan", size=14, color=TINT, space_after=0)
    add_notes(slide, "Buka dengan tujuan: bukti foto dan jejak persetujuan, bukan pelatihan klik demi klik.")
    return slide


def slide_agenda(prs, n, total):
    slide = blank(prs)
    add_inner_chrome(slide, n, total)
    add_title(slide, "Agenda", "What we will cover")
    items = [
        ("01", "Tujuan aplikasi", "Checklist walk-around, foto bukti, persetujuan, dan rekap site."),
        ("02", "Siapa yang memakai", "Driver, mekanik, admin site, admin perusahaan, dan superadmin."),
        ("03", "Alur di lapangan", "Pilih unit, isi checklist, foto, simpan draf, atau kirim."),
        ("04", "Persetujuan dan laporan", "Admin meninjau kiriman, mengekspor PDF, dan melihat rekap."),
        ("05", "Yang perlu diingat", "Draf di perangkat, foto berbatas waktu, kiriman tidak disunting."),
    ]
    col_w = Inches(5.85)
    for i, (num, title, body) in enumerate(items):
        col = i % 2
        row = i // 2
        left = MARGIN_X + col * (col_w + Inches(0.28))
        top = Inches(1.78) + row * Inches(1.55)
        if i == 4:
            left = MARGIN_X
            top = Inches(1.78) + 2 * Inches(1.55)
            col_w_last = Inches(12.0)
        else:
            col_w_last = col_w
        add_rect(slide, left, top, col_w_last, Inches(1.38), TINT, rounded=True)
        add_rect(slide, left, top, Inches(0.08), Inches(1.38), ACCENT)
        num_box = add_textbox(slide, left + Inches(0.22), top + Inches(0.2), Inches(0.7), Inches(0.36))
        tf = num_box.text_frame
        write_para(tf, num, size=18, font=FONT_HEAD, bold=True, color=ACCENT, first=True, space_after=0)
        t = add_textbox(slide, left + Inches(0.95), top + Inches(0.18), col_w_last - Inches(1.2), Inches(0.36))
        tf = t.text_frame
        write_para(tf, title, size=16, font=FONT_HEAD, bold=True, first=True, space_after=0)
        b = add_textbox(slide, left + Inches(0.95), top + Inches(0.56), col_w_last - Inches(1.2), Inches(0.66))
        tf = b.text_frame
        tf.word_wrap = True
        write_para(tf, body, size=13, color=MUTED, first=True, space_after=0)
    add_notes(slide, "Janji waktu singkat. Jangan masuk ke konfigurasi server.")
    return slide


def slide_tujuan(prs, n, total):
    slide = blank(prs)
    add_inner_chrome(slide, n, total)
    add_title(slide, "Apa itu Inspeksi Aset", "A digital walk-around with evidence and approval")
    cards = [
        ("Walk-around", "Checklist mengikuti kategori kendaraan, dikurangi item yang dikecualikan pada tipe inspeksi."),
        ("Foto bukti", "Foto diambil di aplikasi. Waktu, lokasi, dan nama pemeriksa tertanam di berkas."),
        ("Persetujuan", "Admin site meninjau kiriman: Setujui atau Tolak. Setelah kirim, isian tidak diubah."),
        ("Rekap site", "Matriks harian per unit: sudah diinspeksi, ada temuan, atau belum. Bisa diekspor."),
    ]
    for i, (k, b) in enumerate(cards):
        left = MARGIN_X + (i % 2) * Inches(6.15)
        top = Inches(1.78) + (i // 2) * Inches(2.35)
        add_card(slide, left, top, Inches(5.95), Inches(2.15), k, b)
    add_notes(slide, "Tekankan bukti dan jejak persetujuan, bukan pengganti keputusan mekanik di lapangan.")
    return slide


def slide_peran(prs, n, total):
    slide = blank(prs)
    add_inner_chrome(slide, n, total)
    add_title(slide, "Siapa yang memakai", "Five roles, from the yard to the company office")
    rows = [
        ("Peran", "Fokus", "Tidak untuk"),
        ("Driver / Mekanik", "Inspeksi baru, draf, dan inspeksi sendiri", "Master data, rekap, persetujuan"),
        ("Admin Site", "Seluruh site, setujui atau tolak, pengguna site", "Master checklist perusahaan"),
        ("Admin Perusahaan", "Checklist, tipe, site, dan rekap perusahaan", "Akun superadmin"),
        ("Superadmin", "Semua perusahaan dan site", "Pekerjaan harian di lapangan"),
    ]
    table_shape = slide.shapes.add_table(len(rows), 3, MARGIN_X, Inches(1.78), Inches(12.22), Inches(4.7))
    style_table(table_shape.table, rows, [Inches(2.8), Inches(5.5), Inches(3.92)])
    add_notes(slide, "Mekanik memakai alur yang sama dengan driver. Admin site tetap melihat seluruh laporan site.")
    return slide


def slide_beranda(prs, n, total):
    slide = blank(prs)
    add_inner_chrome(slide, n, total)
    add_title(slide, "Beranda setelah masuk", "Home after sign-in")
    add_bullets(
        slide, MARGIN_X, BODY_TOP, Inches(6.05), Inches(4.9),
        [
            "Angka hari ini: unit aktif, inspeksi, temuan, dan yang menunggu persetujuan.",
            "Daftar inspeksi terbaru, dengan status Terkirim atau Disetujui.",
            "Menu mengikuti peran. Bahasa EN / ID ada di pojok atas.",
            "Tombol Mulai inspeksi membuka form yang sama dengan Inspeksi Baru.",
        ],
        size=15, space_after=12,
    )
    add_framed_shot(slide, INTRO / "dashboard.png", SHOT_LEFT, BODY_TOP, SHOT_W, SHOT_H)
    add_notes(slide, "Tangkapan dari lingkungan pra-produksi. Jangan sebut kata sandi.")
    return slide


def slide_mulai(prs, n, total):
    slide = blank(prs)
    add_inner_chrome(slide, n, total)
    add_title(slide, "Mulai inspeksi", "Choose the unit, the type, and the hour meter")
    add_bullets(
        slide, MARGIN_X, BODY_TOP, Inches(6.05), Inches(4.9),
        [
            [("Pilih ", False), ("unit dan tipe dulu", True), (". Checklist baru muncul setelah keduanya terisi.", False)],
            [("Isi ", False), ("KM / HM", True), (" sesuai panel kendaraan.", False)],
            "VIN dan konfigurasi penggerak terisi dari data unit.",
            "Ganti site, unit, atau tipe saat form sudah diisi: jawaban dibuang, KM tetap.",
        ],
        size=15, space_after=12,
    )
    add_framed_shot(slide, INTRO / "form.png", SHOT_LEFT, BODY_TOP, SHOT_W, SHOT_H)
    add_notes(slide, "Jangan mulai mengisi item sebelum unit dan tipe dipilih.")
    return slide


def slide_checklist(prs, n, total):
    slide = blank(prs)
    add_inner_chrome(slide, n, total)
    add_title(slide, "Isi checklist", "Every item starts OK; change only what is wrong")
    add_bullets(
        slide, MARGIN_X, BODY_TOP, Inches(6.05), Inches(4.9),
        [
            [("Setiap item dimulai ", False), ("OK", True), (". Ubah hanya yang bermasalah.", False)],
            "Catatan dan foto boleh diisi, termasuk pada item yang tetap OK.",
            "Pilihan status mengikuti item: Not OK, Korosi, Longgar, dan sejenisnya.",
            "Item yang dikecualikan pada tipe inspeksi tidak muncul.",
        ],
        size=15, space_after=12,
    )
    add_framed_shot(slide, INTRO / "checklist.png", SHOT_LEFT, BODY_TOP, SHOT_W, SHOT_H)
    add_notes(slide, "Default OK mempercepat keliling unit. Foto tetap boleh pada item OK.")
    return slide


def slide_foto(prs, n, total):
    slide = blank(prs)
    add_inner_chrome(slide, n, total)
    add_title(slide, "Foto bukti", "A stamped photo stays with the checklist item")
    cards = [
        ("Jepret", "Kamera di aplikasi. Peramban atau ponsel harus mengizinkan kamera."),
        ("Cap bukti", "Tanggal, jam, GPS bila tersedia, lokasi, dan nama pemeriksa tertanam di foto."),
        ("Ukuran", "Berkas dikompresi otomatis, paling besar 500 KB, lalu menempel di item."),
        ("Masa simpan", "Foto disimpan 90 hari. Catatan inspeksi tetap ada setelah berkas dibersihkan."),
    ]
    for i, (k, b) in enumerate(cards):
        left = MARGIN_X + (i % 2) * Inches(6.15)
        top = Inches(1.78) + (i // 2) * Inches(2.35)
        add_card(slide, left, top, Inches(5.95), Inches(2.15), k, b)
    add_notes(slide, "GPS boleh tercatat tidak tersedia. Itu tidak membatalkan inspeksi.")
    return slide


def slide_draf(prs, n, total):
    slide = blank(prs)
    add_inner_chrome(slide, n, total)
    add_title(slide, "Draf, offline, dan Android", "Save on the device, then sync when the network returns")
    add_bullets(
        slide, MARGIN_X, Inches(1.78), Inches(12.1), Inches(4.9),
        [
            [("Simpan progres", True), (" menyimpan draf di perangkat ini saja. Draf tidak naik ke server.", False)],
            "Draf hilang jika ganti peramban, hapus data situs, atau pindah ponsel.",
            [("Driver, mekanik, dan admin site", True), (" dapat mengantre inspeksi saat offline, lalu menekan Sinkron.", False)],
            "Admin perusahaan dan superadmin tetap bekerja saat tersambung.",
            "Aplikasi Android memakai alur yang sama. PDF dari ponsel dibagikan lewat lembar berbagi Android.",
            [("Setelah ", False), ("Kirim", True), (", inspeksi tidak bisa diedit. Status berjalan dari Terkirim ke Disetujui atau Ditolak.", False)],
        ],
        size=16, space_after=12,
    )
    add_notes(slide, "Jangan menjanjikan draf sebagai arsip perusahaan.")
    return slide


def slide_persetujuan(prs, n, total):
    slide = blank(prs)
    add_inner_chrome(slide, n, total)
    add_title(slide, "Persetujuan", "A site admin approves or rejects the submission")
    add_bullets(
        slide, MARGIN_X, BODY_TOP, Inches(6.05), Inches(4.9),
        [
            "Buka Laporan Inspeksi, pilih kiriman, tinjau item dan foto.",
            [("Setujui", True), (" atau ", False), ("Tolak", True), (". Catatan admin bersifat opsional.", False)],
            "Tombol hanya muncul selagi status masih Terkirim.",
            "Ekspor PDF ada di halaman yang sama, termasuk foto temuan.",
        ],
        size=15, space_after=12,
    )
    add_framed_shot(slide, INTRO / "detail.png", SHOT_LEFT, BODY_TOP, SHOT_W, SHOT_H)
    add_notes(slide, "Jangan menekan Setujui atau Tolak saat demo jika datanya milik operasi nyata.")
    return slide


def slide_laporan(prs, n, total):
    slide = blank(prs)
    add_inner_chrome(slide, n, total)
    add_title(slide, "Laporan dan PDF", "Filter the list, then export one inspection")
    cards = [
        ("Laporan Inspeksi", "Filter unit, status, tanggal, dan pemeriksa. Admin site melihat seluruh site. Driver melihat miliknya."),
        ("Ekspor PDF", "Satu inspeksi menjadi berkas A4: ringkasan, tabel item, dan foto. Tautan membuka detail di aplikasi."),
        ("Ekspor CSV", "Daftar yang sedang difilter dapat diunduh sebagai CSV untuk olah di spreadsheet."),
        ("Inspeksi Saya", "Driver, mekanik, dan admin site melihat kiriman mereka sendiri, terpisah dari laporan site."),
    ]
    for i, (k, b) in enumerate(cards):
        left = MARGIN_X + (i % 2) * Inches(6.15)
        top = Inches(1.78) + (i // 2) * Inches(2.35)
        add_card(slide, left, top, Inches(5.95), Inches(2.15), k, b)
    add_notes(slide, "PDF mengikuti domain tempat aplikasi dibuka. Jangan janji sunting PDF di dalam sistem.")
    return slide


def slide_rekap(prs, n, total):
    slide = blank(prs)
    add_inner_chrome(slide, n, total)
    add_title(slide, "Rekap kendaraan site", "A daily matrix of which units were inspected")
    add_bullets(
        slide, MARGIN_X, BODY_TOP, Inches(6.05), Inches(4.9),
        [
            [("Hijau", True), (" = diinspeksi, semua OK. ", False), ("Merah", True), (" = ada temuan. Abu = belum diinspeksi.", False)],
            "Beberapa inspeksi di hari yang sama mengikuti inspeksi terakhir. Sel merah jika ada temuan.",
            "Ekspor CSV matriks dan CSV ringkasan untuk rentang tanggal yang dipilih.",
            "Admin perusahaan memilih site di perusahaannya. Superadmin memilih site lebih dulu.",
        ],
        size=15, space_after=12,
    )
    add_framed_shot(slide, INTRO / "recap.png", SHOT_LEFT, BODY_TOP, SHOT_W, SHOT_H)
    add_notes(slide, "Warna mengikuti keterangan di layar. Jangan menambah arti di luar itu.")
    return slide


def slide_ingat(prs, n, total):
    slide = blank(prs)
    add_inner_chrome(slide, n, total)
    add_title(slide, "Yang perlu diingat", "Three limits worth stating before go-live")
    points = [
        ("Checklist mengikuti unit dan tipe", "Yang tampil adalah item kategori kendaraan, dikurangi item yang dikecualikan pada tipe."),
        ("Draf hanya di perangkat", "Simpan progres tidak naik ke server. Ganti ponsel atau hapus data situs berarti draf hilang."),
        ("Foto 90 hari", "Berkas foto dapat dibersihkan setelah masa simpan. Baris inspeksi dan catatannya tetap ada."),
        ("Setelah kirim, selesai", "Isian tidak disunting. Koreksi dilakukan lewat inspeksi baru atau keputusan admin."),
    ]
    for i, (k, b) in enumerate(points):
        top = Inches(1.72) + i * Inches(1.22)
        add_rect(slide, MARGIN_X, top, Inches(0.12), Inches(1.06), ACCENT, rounded=True)
        add_rect(slide, MARGIN_X + Inches(0.12), top, Inches(12.1), Inches(1.06), TINT)
        t = add_textbox(slide, MARGIN_X + Inches(0.38), top + Inches(0.1), Inches(11.6), Inches(0.34))
        tf = t.text_frame
        write_para(tf, k, size=16, font=FONT_HEAD, bold=True, first=True, space_after=0)
        d = add_textbox(slide, MARGIN_X + Inches(0.38), top + Inches(0.46), Inches(11.6), Inches(0.5))
        tf = d.text_frame
        tf.word_wrap = True
        write_para(tf, b, size=13, color=MUTED, first=True, space_after=0)
    add_notes(slide, "Tiga pesan: exclude tipe, draf lokal, foto 90 hari.")
    return slide


def build():
    missing = [name for name in ("dashboard.png", "form.png", "checklist.png", "detail.png", "recap.png") if not (INTRO / name).exists()]
    if missing:
        raise SystemExit(f"Missing screenshots in {INTRO}: {', '.join(missing)}")
    if not LOGO.exists():
        raise SystemExit(f"Logo not found: {LOGO}")
    prs = new_prs()
    builders = [
        lambda: slide_cover(prs),
        lambda: slide_agenda(prs, 2, TOTAL),
        lambda: slide_tujuan(prs, 3, TOTAL),
        lambda: slide_peran(prs, 4, TOTAL),
        lambda: slide_beranda(prs, 5, TOTAL),
        lambda: slide_mulai(prs, 6, TOTAL),
        lambda: slide_checklist(prs, 7, TOTAL),
        lambda: slide_foto(prs, 8, TOTAL),
        lambda: slide_draf(prs, 9, TOTAL),
        lambda: slide_persetujuan(prs, 10, TOTAL),
        lambda: slide_laporan(prs, 11, TOTAL),
        lambda: slide_rekap(prs, 12, TOTAL),
        lambda: slide_ingat(prs, 13, TOTAL),
    ]
    for fn in builders:
        fn()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(OUT))
    print(f"Wrote {OUT} ({OUT.stat().st_size} bytes, {len(prs.slides)} slides)")


if __name__ == "__main__":
    build()


