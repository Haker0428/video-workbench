use std::fmt;

/// 应用错误：命令返回给前端时序列化为错误字符串。
#[derive(Debug)]
pub enum AppError {
    /// 本地配置不合法（如 base_url 无法解析）。
    Config(String),
    /// 网络连接失败/超时（服务不可达）。
    Conn(String),
    /// H3 服务返回非预期 HTTP 状态。
    Api { status: u16, message: String },
    /// 本地文件系统错误。
    Io(String),
    /// 请求参数不合法（前端输入校验后置防线）。
    Invalid(String),
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::Config(m) => write!(f, "config error: {m}"),
            AppError::Conn(m) => write!(f, "connection failed: {m}"),
            AppError::Api { status, message } => write!(f, "h3 api {status}: {message}"),
            AppError::Io(m) => write!(f, "io error: {m}"),
            AppError::Invalid(m) => write!(f, "invalid request: {m}"),
        }
    }
}

impl std::error::Error for AppError {}

impl serde::Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            AppError::Conn(format!("timeout: {e}"))
        } else if e.is_connect() {
            AppError::Conn(format!("cannot connect: {e}"))
        } else {
            AppError::Conn(e.to_string())
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
