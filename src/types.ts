export interface Settings {
  version: number;
  theme: "system" | "light" | "dark";
  fontSize: number;
  compact: boolean;
  showImages: boolean;
  cacheLimitMb: number;
  rememberLogin: boolean;
  articleImages: boolean;
  readOnly: boolean;
  uiFont: string;
  bodyFont: string;
  lineHeight: number;
  autoOpenArticle: boolean;
  showCommentComposer: boolean;
  pinnedCard: boolean;
  circleGrid: boolean;
  validateSessionOnStart: boolean;
  deviceTailMode: "official" | "windows" | "detected";
  notificationsEnabled: boolean;
  notifyNews: boolean;
  notifyReplies: boolean;
  notifyMessages: boolean;
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
  pinned?: boolean;
  advertisement?: boolean;
  video?: boolean;
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
  deviceTailModel?: DeviceTail | string | null;
  tail?: string | null;
  pictures?: { src: string; originSrc?: string }[];
}
export interface DeviceTail {
  name?: string | null;
  color?: string | null;
  darkColor?: string | null;
  extraTails?: DeviceTail[];
}
export interface CommentsPage {
  newsId: number;
  hotCount?: number;
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
export type CircleKind = "latest" | "recommend" | "topic" | "detail" | "comments" | "floor";
export interface CircleUser {
  id: number;
  userNick: string;
  userAvatar?: string;
  level?: number;
}
export interface CirclePost {
  id: number;
  contentId?: number;
  voteStatus?: number;
  starStatus?: number;
  title?: string;
  user: CircleUser;
  createTime: string;
  location?: string;
  deviceTailModel?: DeviceTail;
  contents: CommentElement[];
  pictures?: { src: string; thumbSrc?: string; originSrc?: string }[];
  videos?: { src?: string; url?: string }[];
  topics?: CircleTopic[];
  support: number;
  commentCount?: number;
  floorStr?: string;
  replyUser?: CircleUser;
  replyCount?: number;
  replyComments?: CirclePost[];
  contentFlagTitle?: string;
}
export interface CircleTopic { id: number; name: string; logo?: string; hotCount?: number }
export interface CirclePage {
  pageStamp?: string;
  leftCount?: number;
  list: { feedType: number; feedContent: CirclePost & { data?: CircleTopic[] } }[];
}
export interface CircleComments { list: CirclePost[]; }
export const defaultSettings: Settings = {
  version: 1,
  theme: "system",
  fontSize: 17,
  compact: true,
  showImages: true,
  cacheLimitMb: 512,
  rememberLogin: false,
  articleImages: true,
  readOnly: false,
  uiFont: "system",
  bodyFont: "system",
  lineHeight: 1.9,
  autoOpenArticle: true,
  showCommentComposer: true,
  pinnedCard: true,
  circleGrid: true,
  validateSessionOnStart: true,
  deviceTailMode: "official",
  notificationsEnabled: false,
  notifyNews: true,
  notifyReplies: true,
  notifyMessages: false,
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
