from typing import Optional

from pydantic import BaseModel


class HomeCollectionEntry(BaseModel):
    id: int
    name: str
    slug: str
    icon: Optional[str] = None
    color: Optional[str] = None
