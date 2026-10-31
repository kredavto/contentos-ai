import Link from 'next/link';
export default function IdeaNotFound(){
  return <section className="page-container stack"><h1>Идея недоступна</h1><p>Она не найдена в указанном бренде или у вас больше нет доступа.</p><Link className="button secondary" href="/dashboard">Вернуться к организациям</Link></section>;
}
