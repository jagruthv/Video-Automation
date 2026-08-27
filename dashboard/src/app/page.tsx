import { createClient } from '@/utils/supabase/server'
import { cookies } from 'next/headers'

export default async function Page() {
  const cookieStore = await cookies()
  const supabase = createClient(cookieStore)

  const { data: queue } = await supabase
    .from('aura_queue')
    .select()
    .order('created_at', { ascending: false })

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-6">AURA Staging Queue</h1>
      <ul className="space-y-4">
        {queue?.map((item) => (
          <li key={item.id} className="border rounded-lg p-4 bg-white shadow">
            <p className="font-semibold">{item.title}</p>
            <p className="text-sm text-gray-500">Status: {item.status}</p>
            <a
              href={item.video_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 text-sm underline"
            >
              Watch Video
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}
