use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInput {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub system_prompt: String,
}

#[derive(Deserialize, Serialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum StreamEvent {
    Delta { text: String },
    Done,
}

pub fn endpoint(base: &str, anthropic: bool) -> Result<reqwest::Url, String> {
    let mut url = reqwest::Url::parse(base).map_err(|_| "请输入有效的接口地址。")?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("请输入有效的 HTTP 或 HTTPS 接口地址。".into());
    }
    let suffix = if anthropic {
        "/messages"
    } else {
        "/chat/completions"
    };
    let mut path = url.path().trim_end_matches('/').to_owned();
    if path.is_empty() {
        path = "/v1".into();
    }
    if !path.ends_with(suffix) {
        path.push_str(suffix);
    }
    url.set_path(&path);
    url.set_fragment(None);
    Ok(url)
}

#[derive(Default)]
pub struct SseDecoder {
    buffer: Vec<u8>,
}
impl SseDecoder {
    pub fn push(&mut self, chunk: &[u8]) -> Result<(), String> {
        self.buffer.extend_from_slice(chunk);
        if self.buffer.len() > 2_000_000 {
            return Err("模型返回的数据块过大。".into());
        }
        Ok(())
    }
    pub fn next(&mut self, eof: bool) -> Result<Option<String>, String> {
        let boundary = self
            .buffer
            .windows(2)
            .position(|s| s == b"\n\n")
            .map(|i| (i, 2))
            .into_iter()
            .chain(
                self.buffer
                    .windows(4)
                    .position(|s| s == b"\r\n\r\n")
                    .map(|i| (i, 4)),
            )
            .min_by_key(|(index, _)| *index);
        let Some((end, separator)) = boundary.or_else(|| {
            if eof && !self.buffer.is_empty() {
                Some((self.buffer.len(), 0))
            } else {
                None
            }
        }) else {
            return Ok(None);
        };
        let frame = String::from_utf8(self.buffer.drain(..end).collect())
            .map_err(|_| "模型返回了无效的 UTF-8 文本。")?;
        self.buffer.drain(..separator);
        Ok(Some(
            frame
                .lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .map(str::trim_start)
                .collect::<Vec<_>>()
                .join("\n"),
        ))
    }
}

pub fn normalize(data: &str, anthropic: bool) -> Result<Option<StreamEvent>, String> {
    if data == "[DONE]" {
        return Ok(Some(StreamEvent::Done));
    }
    let event: Value = serde_json::from_str(data).map_err(|_| "模型返回的数据格式不正确。")?;
    if event.get("error").is_some() {
        return Err(event
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("模型服务返回了错误。")
            .to_owned());
    }
    if anthropic {
        match event.get("type").and_then(Value::as_str) {
            Some("message_stop") => return Ok(Some(StreamEvent::Done)),
            Some("content_block_delta")
                if event.pointer("/delta/type").and_then(Value::as_str) == Some("text_delta") =>
            {
                if let Some(text) = event.pointer("/delta/text").and_then(Value::as_str) {
                    return Ok(Some(StreamEvent::Delta { text: text.into() }));
                }
            }
            Some("content_block_start") => {
                if let Some(text) = event
                    .pointer("/content_block/text")
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty())
                {
                    return Ok(Some(StreamEvent::Delta { text: text.into() }));
                }
            }
            _ => {}
        }
    } else if let Some(text) = event
        .pointer("/choices/0/delta/content")
        .or_else(|| event.pointer("/choices/0/delta/refusal"))
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
    {
        return Ok(Some(StreamEvent::Delta { text: text.into() }));
    }
    Ok(None)
}

pub async fn run_chat(
    input: &ChatInput,
    cancellation: CancellationToken,
    mut emit: impl FnMut(StreamEvent) -> Result<(), String>,
) -> Result<(), String> {
    if !matches!(input.provider.as_str(), "openai" | "anthropic") || input.model.trim().is_empty() {
        return Err("请在设置中选择协议并填写模型 ID。".into());
    }
    if input.api_key.len() > 8192
        || input.system_prompt.len() > 80000
        || input.messages.is_empty()
        || input.messages.len() > 1000
        || input
            .messages
            .iter()
            .any(|m| !matches!(m.role.as_str(), "user" | "assistant"))
    {
        return Err("请求内容格式不正确。".into());
    }
    let anthropic = input.provider == "anthropic";
    let mut body =
        json!({ "model": input.model.trim(), "messages": input.messages, "stream": true });
    if anthropic {
        body["max_tokens"] = json!(4096);
        if !input.system_prompt.trim().is_empty() {
            body["system"] = json!(input.system_prompt.trim());
        }
    } else if !input.system_prompt.trim().is_empty() {
        body["messages"].as_array_mut().unwrap().insert(
            0,
            json!({ "role": "system", "content": input.system_prompt.trim() }),
        );
    }
    if body.to_string().len() > 2_000_000 {
        return Err("对话过长，请新建对话后重试。".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法创建网络连接。")?;
    let mut request = client
        .post(endpoint(&input.base_url, anthropic)?)
        .header("Accept", "text/event-stream")
        .json(&body);
    if anthropic {
        request = request
            .header("x-api-key", &input.api_key)
            .header("anthropic-version", "2023-06-01");
    } else if !input.api_key.is_empty() {
        request = request.bearer_auth(&input.api_key);
    }
    let response = tokio::select! {
        _ = cancellation.cancelled() => return Err("请求已取消。".into()),
        result = request.send() => result.map_err(|error| if error.is_timeout() { "模型响应超时，请重试。" } else { "无法连接模型服务，请检查接口地址与网络。" })?,
    };
    if !response.status().is_success() {
        let status = response.status().as_u16();
        let details: Value = response.json().await.unwrap_or_default();
        return Err(details
            .pointer("/error/message")
            .or_else(|| details.get("message"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| format!("模型服务返回 HTTP {status}。")));
    }
    if response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("application/json"))
    {
        let value: Value = response
            .json()
            .await
            .map_err(|_| "模型返回的数据格式不正确。")?;
        let text = if anthropic {
            value["content"]
                .as_array()
                .map(|content| {
                    content
                        .iter()
                        .filter(|block| block["type"] == "text")
                        .filter_map(|block| block["text"].as_str())
                        .collect::<String>()
                })
                .unwrap_or_default()
        } else {
            value
                .pointer("/choices/0/message/content")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned()
        };
        if text.is_empty() {
            return Err("模型没有返回文本内容。".into());
        }
        emit(StreamEvent::Delta { text })?;
        emit(StreamEvent::Done)?;
        return Ok(());
    }
    let mut stream = response.bytes_stream();
    let mut decoder = SseDecoder::default();
    loop {
        let chunk = tokio::select! {
            _ = cancellation.cancelled() => return Err("请求已取消。".into()),
            next = stream.next() => next,
        };
        let eof = chunk.is_none();
        if let Some(chunk) = chunk {
            decoder.push(&chunk.map_err(|_| "网络连接中断，已保留收到的内容。")?)?;
        }
        while let Some(data) = decoder.next(eof)? {
            if data.is_empty() {
                continue;
            }
            if let Some(event) = normalize(&data, anthropic)? {
                let done = event == StreamEvent::Done;
                emit(event)?;
                if done {
                    return Ok(());
                }
            }
        }
        if eof {
            return Err("连接提前中断，已保留收到的内容。请重试。".into());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn utf8_and_crlf_boundaries() {
        let mut decoder = SseDecoder::default();
        let mut output = Vec::new();
        for byte in
            ": ping\r\n\r\ndata: 你好🌱\r\n\r\ndata: first\ndata: second\n\ndata: [DONE]".as_bytes()
        {
            decoder.push(&[*byte]).unwrap();
            while let Some(data) = decoder.next(false).unwrap() {
                if !data.is_empty() {
                    output.push(data);
                }
            }
        }
        while let Some(data) = decoder.next(true).unwrap() {
            output.push(data);
        }
        assert_eq!(output, ["你好🌱", "first\nsecond", "[DONE]"]);
    }
    #[test]
    fn endpoints_and_schemes() {
        assert_eq!(
            endpoint("https://example.com", false).unwrap().as_str(),
            "https://example.com/v1/chat/completions"
        );
        assert_eq!(
            endpoint("https://example.com/v1/messages", true)
                .unwrap()
                .path(),
            "/v1/messages"
        );
        assert!(endpoint("file:///etc/passwd", false).is_err());
        assert!(endpoint("https://user:pass@example.com", false).is_err());
    }
    #[test]
    fn normalize_provider_events() {
        assert_eq!(
            normalize(r#"{"choices":[{"delta":{"content":"你好"}}]}"#, false).unwrap(),
            Some(StreamEvent::Delta {
                text: "你好".into()
            })
        );
        assert_eq!(
            normalize(r#"{"type":"message_stop"}"#, true).unwrap(),
            Some(StreamEvent::Done)
        );
        assert_eq!(
            normalize(
                r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"世界"}}"#,
                true
            )
            .unwrap(),
            Some(StreamEvent::Delta {
                text: "世界".into()
            })
        );
        assert!(normalize(r#"{"error":{"message":"rate limit"}}"#, true).is_err());
    }
}
