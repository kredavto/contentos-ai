import Link from 'next/link';
export default function ScriptNotFound(){
  return <section className="page-container stack"><h1>Сценарий недоступен</h1><p>Он не найден в указанном бренде или у вас больше нет доступа.</p><Link className="button secondary" href="/dashboard">Вернуться к организациям</Link></section>;
}
