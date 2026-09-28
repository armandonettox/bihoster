from pydantic import BaseModel


class EmbedConfig(BaseModel):
    report_id: str
    embed_url: str
    access_token: str


class RefreshHistoryItem(BaseModel):
    status: str
    startTime: str | None = None
    endTime: str | None = None
