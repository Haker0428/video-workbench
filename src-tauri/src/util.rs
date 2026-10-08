use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::Path;

/// 临时文件 + rename 的原子写，保证 tasks.json / config.json 不会写一半损坏。
pub fn atomic_write(path: &Path, data: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut f = File::create(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    if let Some(dir) = path.parent() {
        if let Ok(d) = File::open(dir) {
            let _ = d.sync_all();
        }
    }
    Ok(())
}

/// 简易 Range 头解析（单区间）。返回闭区间 (start, end)。
/// 支持 `bytes=a-b`、`bytes=a-`、`bytes=-suffix`；无法解析返回 None。
pub fn parse_range(header: Option<&str>, len: u64) -> Option<(u64, u64)> {
    let h = header?;
    let h = h.trim();
    let rest = h.strip_prefix("bytes=")?;
    if len == 0 {
        return None;
    }
    let seg = rest.split(',').next()?.trim();
    let (s, e) = seg.split_once('-')?;
    let (s, e) = (s.trim(), e.trim());
    if s.is_empty() {
        // 后缀区间：最后 N 字节
        let n: u64 = e.parse().ok()?;
        if n == 0 {
            return None;
        }
        let start = len.saturating_sub(n);
        return Some((start, len - 1));
    }
    let start: u64 = s.parse().ok()?;
    if start >= len {
        return None;
    }
    let end = if e.is_empty() {
        len - 1
    } else {
        e.parse::<u64>().ok()?.min(len - 1)
    };
    if start > end {
        return None;
    }
    Some((start, end))
}

/// 从文件读取 [start, end]（闭区间）区间内容。
pub fn read_range(path: &Path, start: u64, end: u64) -> io::Result<Vec<u8>> {
    let mut f = File::open(path)?;
    f.seek(SeekFrom::Start(start))?;
    let n = usize::try_from(end - start + 1).unwrap_or(usize::MAX);
    let mut buf = Vec::with_capacity(n.min(8 * 1024 * 1024));
    f.take(n as u64).read_to_end(&mut buf)?;
    Ok(buf)
}

/// 通过魔数嗅探图片 MIME（拖拽/文件选择时浏览器 MIME 不可信）。
pub fn sniff_image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// 通过魔数嗅探音视频 MIME（Ref2VA 参考素材）。
pub fn sniff_media_mime(bytes: &[u8]) -> Option<&'static str> {
    // mp4/m4a/mov 系：offset 4 起为 "ftyp"
    if bytes.len() > 12 && &bytes[4..8] == b"ftyp" {
        if &bytes[8..12] == b"M4A " {
            return Some("audio/mp4");
        }
        return Some("video/mp4");
    }
    if bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        return Some("video/webm");
    }
    if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WAVE" {
        return Some("audio/wav");
    }
    if bytes.starts_with(b"OggS") {
        return Some("audio/ogg");
    }
    if bytes.starts_with(b"fLaC") {
        return Some("audio/flac");
    }
    // mp3：ID3 头或帧同步字节
    if bytes.starts_with(b"ID3")
        || (bytes.len() > 2 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0)
    {
        return Some("audio/mpeg");
    }
    None
}

pub fn mime_to_ext(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "audio/wav" => "wav",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "m4a",
        "audio/ogg" => "ogg",
        "audio/flac" => "flac",
        _ => "bin",
    }
}

pub fn ext_to_mime(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn range_parsing() {
        assert_eq!(parse_range(Some("bytes=0-99"), 1000), Some((0, 99)));
        assert_eq!(parse_range(Some("bytes=500-"), 1000), Some((500, 999)));
        assert_eq!(parse_range(Some("bytes=-200"), 1000), Some((800, 999)));
        assert_eq!(parse_range(Some("bytes=990-2000"), 1000), Some((990, 999)));
        assert_eq!(parse_range(Some("bytes=2000-"), 1000), None);
        assert_eq!(parse_range(None, 1000), None);
    }
}
