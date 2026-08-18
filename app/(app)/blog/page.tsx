import { redirect } from "next/navigation";

// /blog was the home-layout editor; it lives at /blog/home now (reached from Blog settings), and
// the Home submenu item is gone — Posts is the section's front page, matching how every other
// sidebar section opens on its list. The redirect keeps old bookmarks and in-app links working.
export default function BlogRoot() {
  redirect("/blog/posts");
}
