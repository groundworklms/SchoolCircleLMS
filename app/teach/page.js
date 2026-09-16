import { redirect } from 'next/navigation';

/* Legacy entry point. The instructor app lives in the prototype shell now
   (/prototype/instructor/...); this keeps old links and bookmarks working. */
export default function TeachPage() {
  redirect('/prototype/instructor');
}
