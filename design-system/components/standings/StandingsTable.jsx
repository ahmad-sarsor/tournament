import React from "react";
import { FormGuide } from "./FormGuide.jsx";

const MEDALS = { 1: "🥇", 2: "🥈", 3: "🥉" };

/** جدول ترتيب بيت واحد — الأعمدة الأصلية: # الفريق لعب ف ت خ (له عليه الفارق) نقاط السجل */
export function StandingsTable({ rows = [], qualifiers = 2, showExtra = false, medals = false }) {
  return (
    <div className={`standings-wrap${showExtra ? " show-all" : ""}`}>
      <div className="table-wrap">
        <table className="standings">
          <thead>
            <tr>
              <th className="rank-col">#</th>
              <th className="team-col">الفريق</th>
              <th className="stat-col" title="لعب">لعب</th>
              <th className="stat-col" title="فوز">ف</th>
              <th className="stat-col" title="تعادل">ت</th>
              <th className="stat-col" title="خسارة">خ</th>
              <th className="stat-col col-extra">له</th>
              <th className="stat-col col-extra">عليه</th>
              <th className="stat-col col-extra">الفارق</th>
              <th className="pts-col">نقاط</th>
              <th className="col-extra">السجل</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const qualify = qualifiers > 0 && r.rank <= qualifiers && r.played > 0;
              const champion = r.rank === 1 && r.played > 0;
              const gd = r.gd ?? (r.gf ?? 0) - (r.ga ?? 0);
              const medal = medals ? MEDALS[r.rank] : null;
              return (
                <tr key={r.name} className={`${qualify ? "qualify" : ""} ${champion ? "champion" : ""}`.trim()}>
                  <td><span className={`rank${medal ? " medal" : ""}`}>{medal || String(r.rank)}</span></td>
                  <td className="team-col"><span className="team-name">{r.name}</span></td>
                  <td>{String(r.played)}</td>
                  <td>{String(r.won)}</td>
                  <td>{String(r.drawn)}</td>
                  <td>{String(r.lost)}</td>
                  <td className="col-extra">{String(r.gf ?? 0)}</td>
                  <td className="col-extra">{String(r.ga ?? 0)}</td>
                  <td className={`pos-diff col-extra${gd > 0 ? " pos" : gd < 0 ? " neg" : ""}`}>{(gd > 0 ? "+" : "") + gd}</td>
                  <td><span className="pts">{String(r.points)}</span></td>
                  <td className="col-extra">{r.form ? <FormGuide results={r.form} /> : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
