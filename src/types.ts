export interface Settings {
  version: number;
  theme: "system" | "light" | "dark";
  fontSize: number;
  compact: boolean;
  showImages: boolean;
  cacheLimitMb: number;
  rememberLogin: boolean;
}
export interface Profile {
  id: number;
  nick: string;
}
export interface NewsItem {
  id: number;
  title: string;
  date: string;
  orderDate: string;
  summary: string;
  image: string;
  url: string;
  comments: number;
  forbidComment: boolean;
}
export interface Article {
  item: NewsItem;
  html: string;
  author: string;
  source: string;
  sn: string;
}
export interface Cached<T> {
  data: T;
  savedAt: number;
  stale: boolean;
}
export interface Bootstrap {
  settings: Settings;
  profile: Profile;
  channel: string;
  version: string;
  warnings: string[];
}
export interface CommentElement {
  type: number;
  content?: string;
  src?: string;
  link?: string;
}
export interface OfficialComment {
  id: number;
  city?: string;
  postTime: string;
  support: number;
  against: number;
  userInfo: {
    id: number;
    userNick: string;
    userAvatar?: string;
    level?: number;
  };
  elements: CommentElement[];
  children?: OfficialComment[];
  expandCount?: number;
  parentCommentId: number;
  replyCommentId: number;
  replyUserInfo?: { userNick: string };
  floorStr: string;
  voteStatus?: number;
  checkStatus?: number;
  aiHint?: string;
  deviceTailModel?: unknown;
}
export interface CommentsPage {
  newsId: number;
  userId: number;
  userNick: string | null;
  canComment: boolean;
  cannotCommentTip: string | null;
  ruleHint: string;
  endHint?: string;
  comments: OfficialComment[];
  hotComments?: OfficialComment[];
}
export interface Stats {
  cacheBytes: number;
  historyCount: number;
  favoritesCount: number;
}
export const defaultSettings: Settings = {
  version: 1,
  theme: "system",
  fontSize: 17,
  compact: true,
  showImages: true,
  cacheLimitMb: 512,
  rememberLogin: false,
};
export const channels = [
  { id: "news", name: "最新" },
  { id: "win11", name: "Windows" },
  { id: "android", name: "安卓" },
  { id: "ios", name: "苹果" },
  { id: "digi", name: "数码" },
  { id: "it", name: "业界" },
  { id: "auto", name: "汽车" },
  { id: "game", name: "游戏" },
];
