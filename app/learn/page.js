import { redirect } from 'next/navigation';

/* Legacy entry point. The learner app lives in the prototype shell now
   (/prototype/...); this keeps old links and bookmarks working. The manual
   course player under /learn/library is its own page and is unaffected. */
export default function LearnPage() {
  redirect('/prototype');
}
