import CachedImage from "./CachedImage";
import { avatarUrl } from "../account-domain";

export default function UserAvatar({ id, name = "家友", src, size = 40, interactive = true }: { id: number; name?: string; src?: string; size?: number; interactive?: boolean }) {
  return <button type="button" className="user-avatar" style={{ width: size, height: size }}
    aria-label={`查看${name}的个人主页`} disabled={!id || !interactive}
    onClick={() => window.dispatchEvent(new CustomEvent("ithome-user", { detail: { id, name } }))}>
    <span aria-hidden="true">{name.slice(0, 1)}</span>
    <CachedImage src={src || avatarUrl(id)} alt="" />
  </button>;
}
