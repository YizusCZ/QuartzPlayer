use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

const MAX_BLOCK: u64 = 16 * 1024 * 1024;
const THREADS: usize = 3;

#[derive(Default)]
struct Meta {
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    album_artist: Option<String>,
    genre: Option<String>,
    year: Option<i64>,
    track_no: Option<i64>,
    disc_no: Option<i64>,
    duration: Option<f64>,
    codec: &'static str,
    bitrate: Option<f64>,
    sample_rate: Option<f64>,
    channels: Option<f64>,
    bit_depth: Option<f64>,
    picture: Option<(String, Vec<u8>)>,
    lyrics: Option<String>,
}

struct Source {
    file: File,
    size: u64,
}

impl Source {
    /// Like the JS source: clamped at the end of the file, empty past it.
    fn read(&mut self, offset: u64, len: u64) -> Vec<u8> {
        let len = len.min(self.size.saturating_sub(offset));
        if len == 0 || self.file.seek(SeekFrom::Start(offset)).is_err() {
            return Vec::new();
        }
        let mut buf = vec![0; len as usize];
        match self.file.read_exact(&mut buf) {
            Ok(()) => buf,
            Err(_) => Vec::new(),
        }
    }
}

/* Out-of-range reads give 0, as `undefined` does in the JS bit operations. */
#[inline]
fn at(b: &[u8], i: usize) -> u8 {
    b.get(i).copied().unwrap_or(0)
}
fn u16be(b: &[u8], o: usize) -> u32 {
    (at(b, o) as u32) << 8 | at(b, o + 1) as u32
}
fn u24be(b: &[u8], o: usize) -> u32 {
    (at(b, o) as u32) << 16 | (at(b, o + 1) as u32) << 8 | at(b, o + 2) as u32
}
fn u32be(b: &[u8], o: usize) -> u32 {
    (at(b, o) as u32) << 24 | (at(b, o + 1) as u32) << 16 | (at(b, o + 2) as u32) << 8 | at(b, o + 3) as u32
}
fn u16le(b: &[u8], o: usize) -> u32 {
    at(b, o) as u32 | (at(b, o + 1) as u32) << 8
}
fn u32le(b: &[u8], o: usize) -> u32 {
    at(b, o) as u32 | (at(b, o + 1) as u32) << 8 | (at(b, o + 2) as u32) << 16 | (at(b, o + 3) as u32) << 24
}
fn syncsafe(b: &[u8], o: usize) -> u32 {
    ((at(b, o) & 0x7f) as u32) << 21
        | ((at(b, o + 1) & 0x7f) as u32) << 14
        | ((at(b, o + 2) & 0x7f) as u32) << 7
        | (at(b, o + 3) & 0x7f) as u32
}
fn sub(b: &[u8], from: usize, to: usize) -> &[u8] {
    let to = to.min(b.len());
    if from >= to {
        &[]
    } else {
        &b[from..to]
    }
}
fn tag_at(b: &[u8], o: usize, len: usize) -> &[u8] {
    sub(b, o, o.saturating_add(len))
}

fn latin1(b: &[u8]) -> String {
    b.iter().map(|&c| c as char).collect()
}

fn utf8(b: &[u8]) -> String {
    let mut out = String::with_capacity(b.len());
    let mut i = 0;
    let next = |i: &mut usize| {
        let v = (at(b, *i) & 0x3f) as u32;
        *i += 1;
        v
    };
    while i < b.len() {
        let c = b[i] as u32;
        i += 1;
        let cp = if c < 0x80 {
            c
        } else if c < 0xc0 {
            0xfffd
        } else if c < 0xe0 {
            (c & 0x1f) << 6 | next(&mut i)
        } else if c < 0xf0 {
            let a = next(&mut i);
            let z = next(&mut i);
            (c & 0x0f) << 12 | a << 6 | z
        } else {
            let a = next(&mut i);
            let y = next(&mut i);
            let z = next(&mut i);
            (c & 0x07) << 18 | a << 12 | y << 6 | z
        };
        out.push(char::from_u32(cp).unwrap_or('\u{fffd}'));
    }
    out
}

fn utf8_or_latin1(b: &[u8]) -> String {
    let s = utf8(b);
    if s.chars().any(|c| c == '\u{fffd}' || ('\u{80}'..='\u{9f}').contains(&c)) {
        latin1(b)
    } else {
        s
    }
}

fn utf16(b: &[u8], mut big_endian: bool) -> String {
    let mut o = 0;
    if b.len() >= 2 {
        if b[0] == 0xff && b[1] == 0xfe {
            big_endian = false;
            o = 2;
        } else if b[0] == 0xfe && b[1] == 0xff {
            big_endian = true;
            o = 2;
        }
    }
    let units: Vec<u16> = b[o.min(b.len())..]
        .chunks_exact(2)
        .map(|c| if big_endian { u16::from_be_bytes([c[0], c[1]]) } else { u16::from_le_bytes([c[0], c[1]]) })
        .collect();
    String::from_utf16_lossy(&units)
}

fn js_trim(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

fn clean(s: &str) -> String {
    js_trim(&s.trim_end_matches('\0').replace('\0', " / ")).to_string()
}

fn float80(b: &[u8], o: usize) -> f64 {
    let exp = ((at(b, o) & 0x7f) as i32) << 8 | at(b, o + 1) as i32;
    let hi = u32be(b, o + 2) as f64;
    let lo = u32be(b, o + 6) as f64;
    if exp == 0 && hi == 0.0 && lo == 0.0 {
        return 0.0;
    }
    let sign = if at(b, o) & 0x80 != 0 { -1.0 } else { 1.0 };
    sign * (hi * 2f64.powi(exp - 16383 - 31) + lo * 2f64.powi(exp - 16383 - 63))
}

/// parseInt(v, 10): leading whitespace, optional sign, then digits.
fn parse_int(v: &str) -> Option<i64> {
    let s = js_trim(v);
    let (neg, digits) = match s.as_bytes().first() {
        Some(b'-') => (true, &s[1..]),
        Some(b'+') => (false, &s[1..]),
        _ => (false, s),
    };
    let end = digits.bytes().position(|c| !c.is_ascii_digit()).unwrap_or(digits.len());
    let n: i64 = digits[..end].parse().ok()?;
    Some(if neg { -n } else { n })
}

fn set_year(v: &str, m: &mut Meta) {
    let b = v.as_bytes();
    if let Some(w) = b.windows(4).find(|w| w.iter().all(u8::is_ascii_digit)) {
        m.year = std::str::from_utf8(w).ok().and_then(|s| s.parse().ok());
    }
}

fn clean_genre(v: &str) -> Option<String> {
    let mut s = v;
    if let Some(rest) = v.strip_prefix('(') {
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        if digits > 0 && rest.as_bytes().get(digits) == Some(&b')') {
            s = &rest[digits + 1..];
        }
    }
    let s = js_trim(s);
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

fn apply_tag(key: &str, v: &str, m: &mut Meta) {
    if v.is_empty() {
        return;
    }
    let keep = |slot: &mut Option<String>| {
        if slot.is_none() {
            *slot = Some(v.to_string());
        }
    };
    match key {
        "TITLE" => keep(&mut m.title),
        "ARTIST" => keep(&mut m.artist),
        "ALBUM" => keep(&mut m.album),
        "ALBUMARTIST" | "ALBUM ARTIST" => keep(&mut m.album_artist),
        "GENRE" => {
            if m.genre.is_none() {
                m.genre = clean_genre(v);
            }
        }
        "DATE" | "YEAR" => {
            if m.year.unwrap_or(0) == 0 {
                set_year(v, m);
            }
        }
        "TRACKNUMBER" => {
            if m.track_no.unwrap_or(0) == 0 {
                if let Some(n) = parse_int(v).filter(|n| *n > 0) {
                    m.track_no = Some(n);
                }
            }
        }
        "DISCNUMBER" => {
            if m.disc_no.unwrap_or(0) == 0 {
                if let Some(n) = parse_int(v).filter(|n| *n > 0) {
                    m.disc_no = Some(n);
                }
            }
        }
        "LYRICS" | "UNSYNCEDLYRICS" => keep(&mut m.lyrics),
        _ => {}
    }
}

fn take_picture(m: &mut Meta, mime: String, data: &[u8], front: bool) {
    if !data.is_empty() && (m.picture.is_none() || front) {
        m.picture = Some((mime, data.to_vec()));
    }
}

/* ───────── ID3v2 ───────── */

fn desync(b: &[u8]) -> Vec<u8> {
    let mut r = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        r.push(b[i]);
        if b[i] == 0xff && b.get(i + 1) == Some(&0) {
            i += 1;
        }
        i += 1;
    }
    r
}

fn decode_text(b: &[u8], enc: u8) -> String {
    match enc {
        1 => clean(&utf16(b, false)),
        2 => clean(&utf16(b, true)),
        3 => clean(&utf8(b)),
        _ => clean(&latin1(b)),
    }
}

fn skip_terminated(b: &[u8], pos: usize, enc: u8) -> usize {
    if enc == 1 || enc == 2 {
        let mut i = pos;
        while i + 1 < b.len() {
            if b[i] == 0 && b[i + 1] == 0 {
                return i + 2;
            }
            i += 2;
        }
    } else {
        let mut i = pos;
        while i < b.len() {
            if b[i] == 0 {
                return i + 1;
            }
            i += 1;
        }
    }
    b.len()
}

fn id3_key(id: &[u8]) -> Option<&'static str> {
    Some(match id {
        b"TIT2" | b"TT2" => "TITLE",
        b"TPE1" | b"TP1" => "ARTIST",
        b"TALB" | b"TAL" => "ALBUM",
        b"TPE2" | b"TP2" => "ALBUMARTIST",
        b"TCON" | b"TCO" => "GENRE",
        b"TYER" | b"TYE" => "YEAR",
        b"TDRC" | b"TDRL" => "DATE",
        b"TRCK" | b"TRK" => "TRACKNUMBER",
        b"TPOS" | b"TPA" => "DISCNUMBER",
        _ => return None,
    })
}

fn parse_id3(src: &mut Source, offset: u64, m: &mut Meta) -> u64 {
    let hdr = src.read(offset, 10);
    if tag_at(&hdr, 0, 3) != b"ID3" {
        return 0;
    }
    let ver = at(&hdr, 3);
    let flags = at(&hdr, 5);
    let size = syncsafe(&hdr, 6) as u64;
    let total = 10 + size + if flags & 0x10 != 0 { 10 } else { 0 };
    let mut body = src.read(offset + 10, size.min(MAX_BLOCK));
    if flags & 0x80 != 0 && ver < 4 {
        body = desync(&body);
    }
    let mut pos = 0usize;
    if flags & 0x40 != 0 && ver >= 3 {
        pos += if ver == 3 { u32be(&body, 0) as usize + 4 } else { syncsafe(&body, 0) as usize };
    }
    let id_len = if ver == 2 { 3 } else { 4 };
    let h_len = if ver == 2 { 6 } else { 10 };
    let mut tlen_ms = 0i64;

    while pos + h_len <= body.len() {
        let id = tag_at(&body, pos, id_len);
        if id.is_empty() || !id.iter().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) {
            break;
        }
        let fsize = match ver {
            2 => u24be(&body, pos + 3),
            4 => syncsafe(&body, pos + 4),
            _ => u32be(&body, pos + 4),
        } as usize;
        let fflags = if ver == 2 { 0 } else { u16be(&body, pos + 8) };
        let start = pos + h_len;
        let mut data: Vec<u8> = sub(&body, start, start.saturating_add(fsize)).to_vec();
        pos = start.saturating_add(fsize);
        if fsize == 0 {
            continue;
        }
        if ver == 4 {
            if fflags & 1 != 0 {
                data = sub(&data, 4, data.len()).to_vec();
            }
            if fflags & 2 != 0 {
                data = desync(&data);
            }
        }
        let d = &data[..];
        let enc = at(d, 0);
        if let Some(key) = id3_key(id) {
            apply_tag(key, &decode_text(sub(d, 1, d.len()), enc), m);
        } else if id == b"USLT" || id == b"ULT" {
            let s = skip_terminated(d, 4, enc);
            apply_tag("LYRICS", &decode_text(sub(d, s, d.len()), enc), m);
        } else if id == b"TXXX" {
            let e = skip_terminated(d, 1, enc);
            let desc = decode_text(sub(d, 1, e), enc).to_uppercase();
            if desc == "LYRICS" || desc == "USLT" || desc == "UNSYNCEDLYRICS" {
                apply_tag("LYRICS", &decode_text(sub(d, e, d.len()), enc), m);
            }
        } else if id == b"TLEN" {
            tlen_ms = parse_int(&decode_text(sub(d, 1, d.len()), enc)).unwrap_or(0);
        } else if id == b"APIC" {
            let me = skip_terminated(d, 1, 0);
            let mime = latin1(sub(d, 1, me.saturating_sub(1)));
            let mime = if mime.is_empty() { "image/jpeg".to_string() } else { mime };
            let pic_type = at(d, me);
            let ds = skip_terminated(d, me + 1, enc);
            take_picture(m, mime, sub(d, ds, d.len()), pic_type == 3);
        } else if id == b"PIC" {
            let png = tag_at(d, 1, 3).eq_ignore_ascii_case(b"png");
            let pic_type = at(d, 4);
            let ds = skip_terminated(d, 5, enc);
            let mime = if png { "image/png" } else { "image/jpeg" }.to_string();
            take_picture(m, mime, sub(d, ds, d.len()), pic_type == 3);
        }
    }
    if tlen_ms != 0 && m.duration.unwrap_or(0.0) == 0.0 {
        m.duration = Some(tlen_ms as f64 / 1000.0);
    }
    total
}

/* ───────── MP3 ───────── */

const MP3_BR_V1: [f64; 15] = [0., 32., 40., 48., 56., 64., 80., 96., 112., 128., 160., 192., 224., 256., 320.];
const MP3_BR_V2: [f64; 15] = [0., 8., 16., 24., 32., 40., 48., 56., 64., 80., 96., 112., 128., 144., 160.];

fn parse_mp3(src: &mut Source, m: &mut Meta) {
    m.codec = "MP3";
    let mut start = 0u64;
    for _ in 0..3 {
        let len = parse_id3(src, start, m);
        if len == 0 {
            break;
        }
        start += len;
    }
    let win = src.read(start, 64 * 1024);
    let mut i = 0usize;
    while i + 4 < win.len() {
        let (a, b, c, d) = (win[i], win[i + 1], win[i + 2], win[i + 3]);
        i += 1;
        if a != 0xff || b & 0xe0 != 0xe0 {
            continue;
        }
        let ver = (b >> 3) & 3;
        let layer = (b >> 1) & 3;
        let br = (c >> 4) as usize;
        let sr = ((c >> 2) & 3) as usize;
        if ver == 1 || layer != 1 || br == 0 || br == 15 || sr == 3 {
            continue;
        }
        let at0 = i - 1;
        let v1 = ver == 3;
        let rates = match ver {
            3 => [44100., 48000., 32000.],
            2 => [22050., 24000., 16000.],
            _ => [11025., 12000., 8000.],
        };
        let sample_rate: f64 = rates[sr];
        let mono = d >> 6 == 3;
        let spf = if v1 { 1152. } else { 576. };
        m.sample_rate = Some(sample_rate);
        m.channels = Some(if mono { 1. } else { 2. });

        let xing = at0 + if v1 { if mono { 21 } else { 36 } } else if mono { 13 } else { 21 };
        let tag = tag_at(&win, xing, 4);
        let mut frames = 0u32;
        if (tag == b"Xing" || tag == b"Info") && u32be(&win, xing + 4) & 1 != 0 {
            frames = u32be(&win, xing + 8);
        } else if tag_at(&win, at0 + 36, 4) == b"VBRI" {
            frames = u32be(&win, at0 + 36 + 14);
        }
        let audio = (src.size as f64) - (start as f64) - (at0 as f64);
        if frames > 0 {
            let dur = frames as f64 * spf / sample_rate;
            m.duration = Some(dur);
            m.bitrate = Some(audio * 8. / dur / 1000.);
        } else {
            let rate = if v1 { MP3_BR_V1[br] } else { MP3_BR_V2[br] };
            m.bitrate = Some(rate);
            if m.duration.is_none() {
                m.duration = Some(audio * 8. / (rate * 1000.));
            }
        }
        return;
    }
}

/* ───────── FLAC ───────── */

fn parse_vorbis(b: &[u8], m: &mut Meta) {
    let mut p = 4 + u32le(b, 0) as usize;
    let count = u32le(b, p);
    p += 4;
    let mut i = 0;
    while i < count && p + 4 <= b.len() {
        let len = u32le(b, p) as usize;
        p += 4;
        let s = utf8(sub(b, p, p.saturating_add(len)));
        p = p.saturating_add(len);
        if let Some(eq) = s.find('=').filter(|e| *e > 0) {
            apply_tag(&s[..eq].to_uppercase(), js_trim(&s[eq + 1..]), m);
        }
        i += 1;
    }
}

fn parse_flac(src: &mut Source, m: &mut Meta) {
    m.codec = "FLAC";
    let mut pos = parse_id3(src, 0, m);
    if src.read(pos, 4) != b"fLaC" {
        return;
    }
    pos += 4;
    for _ in 0..128 {
        if pos + 4 > src.size {
            break;
        }
        let h = src.read(pos, 4);
        let last = at(&h, 0) & 0x80 != 0;
        let kind = at(&h, 0) & 0x7f;
        let len = u24be(&h, 1) as u64;
        pos += 4;
        if kind == 0 {
            let b = src.read(pos, 34);
            let rate = (at(&b, 10) as u32) << 12 | (at(&b, 11) as u32) << 4 | (at(&b, 12) as u32) >> 4;
            let channels = ((at(&b, 12) >> 1) & 7) as u32 + 1;
            let bps = (((at(&b, 12) & 1) as u32) << 4 | (at(&b, 13) >> 4) as u32) + 1;
            let samples = (at(&b, 13) & 0x0f) as f64 * 4294967296.0 + u32be(&b, 14) as f64;
            m.sample_rate = Some(rate as f64);
            m.channels = Some(channels as f64);
            m.bit_depth = Some(bps as f64);
            if rate != 0 && samples != 0.0 {
                m.duration = Some(samples / rate as f64);
            }
        } else if kind == 4 && len < MAX_BLOCK {
            let b = src.read(pos, len);
            parse_vorbis(&b, m);
        } else if kind == 6 && len < MAX_BLOCK {
            let b = src.read(pos, len);
            let pic_type = u32be(&b, 0);
            let mime_len = u32be(&b, 4) as usize;
            let mime = latin1(tag_at(&b, 8, mime_len));
            let mut p = 8 + mime_len;
            p += 4 + u32be(&b, p) as usize;
            p += 16;
            let data_len = u32be(&b, p) as usize;
            take_picture(m, mime, sub(&b, p + 4, (p + 4).saturating_add(data_len)), pic_type == 3);
        }
        pos += len;
        if last {
            break;
        }
    }
}

/* ───────── WAV / AIFF ───────── */

fn riff_key(id: &[u8]) -> Option<&'static str> {
    Some(match id {
        b"INAM" => "TITLE",
        b"IART" => "ARTIST",
        b"IPRD" => "ALBUM",
        b"IGNR" => "GENRE",
        b"ICRD" => "DATE",
        b"ITRK" | b"IPRT" => "TRACKNUMBER",
        _ => return None,
    })
}

fn parse_wav(src: &mut Source, m: &mut Meta) {
    m.codec = "WAV";
    let mut pos = 12u64;
    let (mut byte_rate, mut data_size) = (0f64, 0f64);
    for _ in 0..64 {
        if pos + 8 > src.size {
            break;
        }
        let h = src.read(pos, 8);
        let id = tag_at(&h, 0, 4).to_vec();
        let size = u32le(&h, 4) as u64;
        let body = pos + 8;
        if id == b"fmt " {
            let f = src.read(body, size.min(40));
            m.channels = Some(u16le(&f, 2) as f64);
            m.sample_rate = Some(u32le(&f, 4) as f64);
            byte_rate = u32le(&f, 8) as f64;
            m.bit_depth = Some(u16le(&f, 14) as f64);
        } else if id == b"data" {
            data_size = size.min(src.size - body.min(src.size)) as f64;
        } else if id == b"LIST" && size < MAX_BLOCK {
            let b = src.read(body, size);
            if tag_at(&b, 0, 4) == b"INFO" {
                let mut p = 4usize;
                while p + 8 <= b.len() {
                    let sid = tag_at(&b, p, 4);
                    let slen = u32le(&b, p + 4) as usize;
                    if let Some(key) = riff_key(sid) {
                        apply_tag(key, &clean(&utf8_or_latin1(sub(&b, p + 8, (p + 8).saturating_add(slen)))), m);
                    }
                    p = p.saturating_add(8 + slen + (slen & 1));
                }
            }
        } else if id == b"id3 " || id == b"ID3 " {
            parse_id3(src, body, m);
        }
        pos = body + size + (size & 1);
    }
    if byte_rate != 0.0 && data_size != 0.0 {
        m.duration = Some(data_size / byte_rate);
    }
}

fn parse_aiff(src: &mut Source, m: &mut Meta) {
    m.codec = "AIFF";
    let mut pos = 12u64;
    for _ in 0..64 {
        if pos + 8 > src.size {
            break;
        }
        let h = src.read(pos, 8);
        let id = tag_at(&h, 0, 4).to_vec();
        let size = u32be(&h, 4) as u64;
        let body = pos + 8;
        if id == b"COMM" {
            let c = src.read(body, 18);
            let frames = u32be(&c, 2) as f64;
            m.channels = Some(u16be(&c, 0) as f64);
            m.bit_depth = Some(u16be(&c, 6) as f64);
            let rate = float80(&c, 8).round();
            m.sample_rate = Some(rate);
            if rate != 0.0 {
                m.duration = Some(frames / rate);
            }
        } else if id == b"ID3 " || id == b"id3 " {
            parse_id3(src, body, m);
        } else if (id == b"NAME" || id == b"AUTH") && size < 4096 {
            let key = if id == b"NAME" { "TITLE" } else { "ARTIST" };
            let text = clean(&utf8_or_latin1(&src.read(body, size)));
            apply_tag(key, &text, m);
        }
        pos = body + size + (size & 1);
    }
}

/* ───────── MP4 / M4A ───────── */

#[derive(Clone, Copy)]
struct Atom {
    kind: [u8; 4],
    start: usize,
    end: usize,
}

fn atoms(b: &[u8], from: usize, to: usize) -> Vec<Atom> {
    let mut list = Vec::new();
    let mut p = from as u64;
    let to = to as u64;
    while p + 8 <= to {
        let at_p = p as usize;
        let mut size = u32be(b, at_p) as u64;
        let kind = [at(b, at_p + 4), at(b, at_p + 5), at(b, at_p + 6), at(b, at_p + 7)];
        let mut hdr = 8;
        if size == 1 {
            size = (u32be(b, at_p + 8) as u64).saturating_mul(1 << 32).saturating_add(u32be(b, at_p + 12) as u64);
            hdr = 16;
        } else if size == 0 {
            size = to - p;
        }
        if size < hdr {
            break;
        }
        list.push(Atom { kind, start: (p + hdr) as usize, end: p.saturating_add(size).min(to) as usize });
        p = p.saturating_add(size);
    }
    list
}

fn find(list: &[Atom], kind: &[u8; 4]) -> Option<Atom> {
    list.iter().find(|a| &a.kind == kind).copied()
}

fn child(b: &[u8], a: Option<Atom>, kind: &[u8; 4], skip: usize) -> Option<Atom> {
    a.and_then(|a| find(&atoms(b, a.start + skip, a.end), kind))
}

fn parse_mp4(src: &mut Source, m: &mut Meta) {
    m.codec = "AAC";
    let mut pos = 0u64;
    let mut moov = None;
    for _ in 0..64 {
        if pos + 8 > src.size {
            break;
        }
        let h = src.read(pos, 16);
        let mut size = u32be(&h, 0) as u64;
        let kind = tag_at(&h, 4, 4).to_vec();
        let mut hdr = 8;
        if size == 1 {
            size = (u32be(&h, 8) as u64).saturating_mul(1 << 32).saturating_add(u32be(&h, 12) as u64);
            hdr = 16;
        } else if size == 0 {
            size = src.size - pos;
        }
        if size < 8 {
            return;
        }
        if kind == b"moov" {
            moov = Some(src.read(pos + hdr, (size - hdr.min(size)).min(32 * 1024 * 1024)));
            break;
        }
        pos = pos.saturating_add(size);
    }
    let Some(b) = moov else { return };
    let b = &b[..];
    let root = Atom { kind: *b"moov", start: 0, end: b.len() };
    let top = atoms(b, 0, b.len());

    if let Some(mvhd) = find(&top, b"mvhd") {
        let v1 = at(b, mvhd.start) == 1;
        let ts = u32be(b, mvhd.start + if v1 { 20 } else { 12 }) as f64;
        let dur = if v1 {
            u32be(b, mvhd.start + 24) as f64 * 4294967296.0 + u32be(b, mvhd.start + 28) as f64
        } else {
            u32be(b, mvhd.start + 16) as f64
        };
        if ts != 0.0 {
            m.duration = Some(dur / ts);
        }
    }

    for trak in top.iter().filter(|a| &a.kind == b"trak") {
        let stbl = child(b, child(b, child(b, Some(*trak), b"mdia", 0), b"minf", 0), b"stbl", 0);
        let Some(stsd) = child(b, stbl, b"stsd", 0) else { continue };
        let e = stsd.start + 8;
        let fmt = tag_at(b, e + 4, 4);
        if fmt != b"alac" && fmt != b"mp4a" && fmt != b"fLaC" && fmt != b"Opus" {
            continue;
        }
        m.channels = Some(u16be(b, e + 24) as f64);
        m.bit_depth = Some(u16be(b, e + 26) as f64);
        m.sample_rate = Some(u16be(b, e + 32) as f64);
        match fmt {
            b"alac" => {
                m.codec = "ALAC";
                let to = e.saturating_add(u32be(b, e) as usize);
                if let Some(cfg) = find(&atoms(b, e + 36, to), b"alac") {
                    let c = cfg.start + 4;
                    m.bit_depth = Some(at(b, c + 5) as f64);
                    m.channels = Some(at(b, c + 9) as f64);
                    m.sample_rate = Some(u32be(b, c + 20) as f64);
                }
            }
            b"fLaC" => m.codec = "FLAC",
            b"Opus" => m.codec = "OPUS",
            _ => m.bit_depth = None,
        }
        break;
    }

    let ilst = child(b, child(b, child(b, Some(root), b"udta", 0), b"meta", 0), b"ilst", 4)
        .or_else(|| child(b, child(b, Some(root), b"meta", 0), b"ilst", 4));
    let Some(ilst) = ilst else { return };
    for item in atoms(b, ilst.start, ilst.end) {
        let Some(data) = find(&atoms(b, item.start, item.end), b"data") else { continue };
        let kind = u32be(b, data.start) & 0xffffff;
        let payload = sub(b, data.start + 8, data.end);
        let text = || clean(&utf8(payload));
        match &item.kind {
            b"\xa9nam" => apply_tag("TITLE", &text(), m),
            b"\xa9ART" => apply_tag("ARTIST", &text(), m),
            b"\xa9alb" => apply_tag("ALBUM", &text(), m),
            b"aART" => apply_tag("ALBUMARTIST", &text(), m),
            b"\xa9gen" => apply_tag("GENRE", &text(), m),
            b"\xa9day" => apply_tag("DATE", &text(), m),
            b"trkn" => {
                if payload.len() >= 4 && u16be(payload, 2) != 0 {
                    m.track_no = Some(u16be(payload, 2) as i64);
                }
            }
            b"disk" => {
                if payload.len() >= 4 && u16be(payload, 2) != 0 {
                    m.disc_no = Some(u16be(payload, 2) as i64);
                }
            }
            b"\xa9lyr" => apply_tag("LYRICS", &text(), m),
            b"covr" => {
                let mime = if kind == 14 { "image/png" } else { "image/jpeg" }.to_string();
                take_picture(m, mime, payload, true);
            }
            _ => {}
        }
    }
}

/* ───────── entry points ───────── */

fn codec_from_ext(name: &str) -> &'static str {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "flac" => "FLAC",
        "wav" | "wave" => "WAV",
        "aif" | "aiff" | "aifc" => "AIFF",
        "mp3" => "MP3",
        "m4a" | "mp4" | "aac" => "AAC",
        "alac" => "ALAC",
        "ogg" => "OGG",
        "opus" => "OPUS",
        _ => "UNKNOWN",
    }
}

fn parse(src: &mut Source, filename: &str) -> Meta {
    let mut m = Meta { codec: codec_from_ext(filename), ..Meta::default() };
    if src.size < 16 {
        return m;
    }
    let head = src.read(0, 12);
    let magic = tag_at(&head, 0, 4);
    let id3 = tag_at(&head, 0, 3) == b"ID3";
    if magic == b"fLaC" || (id3 && m.codec == "FLAC") {
        parse_flac(src, &mut m);
    } else if magic == b"RIFF" && tag_at(&head, 8, 4) == b"WAVE" {
        parse_wav(src, &mut m);
    } else if magic == b"FORM" && tag_at(&head, 8, 3) == b"AIF" {
        parse_aiff(src, &mut m);
    } else if tag_at(&head, 4, 4) == b"ftyp" {
        parse_mp4(src, &mut m);
    } else if id3 || (at(&head, 0) == 0xff && at(&head, 1) & 0xe0 == 0xe0) {
        parse_mp3(src, &mut m);
    }
    let size = src.size as f64;
    if m.duration.unwrap_or(0.0) == 0.0 && m.bitrate.unwrap_or(0.0) != 0.0 && m.codec != "MP3" {
        m.duration = Some(size * 8. / (m.bitrate.unwrap_or(0.0) * 1000.));
    }
    if let Some(d) = m.duration.filter(|d| *d != 0.0) {
        if m.bitrate.unwrap_or(0.0) == 0.0 {
            m.bitrate = Some(size * 8. / d / 1000.);
        }
    }
    m
}

fn esc(out: &mut String, s: &str) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn str_field(out: &mut String, key: &str, v: &Option<String>) {
    if let Some(v) = v {
        out.push_str(&format!(",\"{key}\":"));
        esc(out, v);
    }
}

fn num_field(out: &mut String, key: &str, v: Option<f64>) {
    if let Some(v) = v.filter(|v| v.is_finite()) {
        out.push_str(&format!(",\"{key}\":{v}"));
    }
}

/// Same picture, same file: an album's songs share one cover on disk.
fn save_picture(pic: &(String, Vec<u8>), art_dir: &str) -> Option<String> {
    if art_dir.is_empty() {
        return None;
    }
    let mut h: u64 = 0xcbf29ce484222325;
    for b in &pic.1 {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    let ext = if pic.0.contains("png") { "png" } else { "jpg" };
    let name = format!("n{h:016x}.{ext}");
    let path = Path::new(art_dir).join(&name);
    if !path.exists() {
        let tmp = Path::new(art_dir).join(format!("{name}.tmp{:?}", std::thread::current().id()));
        fs::write(&tmp, &pic.1).ok()?;
        fs::rename(&tmp, &path).ok()?;
    }
    Some(name)
}

/// JSON for one file; `null` when it cannot be opened (the caller falls back to the JS reader).
pub fn parse_file(path: &str, filename: &str, art_dir: &str) -> String {
    let Ok(file) = File::open(path) else { return "null".into() };
    let Ok(size) = file.metadata().map(|m| m.len()) else { return "null".into() };
    let mut src = Source { file, size };
    let m = parse(&mut src, filename);
    let mut o = format!("{{\"size\":{size}");
    str_field(&mut o, "title", &m.title);
    str_field(&mut o, "artist", &m.artist);
    str_field(&mut o, "album", &m.album);
    str_field(&mut o, "albumArtist", &m.album_artist);
    str_field(&mut o, "genre", &m.genre);
    str_field(&mut o, "lyrics", &m.lyrics);
    num_field(&mut o, "year", m.year.map(|v| v as f64));
    num_field(&mut o, "trackNo", m.track_no.map(|v| v as f64));
    num_field(&mut o, "discNo", m.disc_no.map(|v| v as f64));
    num_field(&mut o, "duration", m.duration);
    o.push_str(",\"format\":{\"codec\":");
    esc(&mut o, m.codec);
    num_field(&mut o, "bitrate", m.bitrate);
    num_field(&mut o, "sampleRate", m.sample_rate);
    num_field(&mut o, "channels", m.channels);
    num_field(&mut o, "bitDepth", m.bit_depth);
    o.push('}');
    if let Some(pic) = &m.picture {
        o.push_str(&format!(",\"pictureSize\":{}", pic.1.len()));
        str_field(&mut o, "picture", &save_picture(pic, art_dir));
    }
    o.push('}');
    o
}

/// `items`: path, name, path, name… separated by 0x1F. A JSON array, in order.
pub fn parse_batch(items: &str, art_dir: &str) -> String {
    let parts: Vec<&str> = items.split('\u{1f}').collect();
    let files: Vec<(&str, &str)> = parts.chunks_exact(2).map(|c| (c[0], c[1])).collect();
    let mut results = vec![String::new(); files.len()];
    let per = files.len().div_ceil(THREADS).max(1);
    std::thread::scope(|s| {
        for (group, slots) in files.chunks(per).zip(results.chunks_mut(per)) {
            s.spawn(move || {
                for ((path, name), slot) in group.iter().zip(slots.iter_mut()) {
                    *slot = parse_file(path, name, art_dir);
                }
            });
        }
    });
    format!("[{}]", results.join(","))
}
