import { DemoReader, EntityMode } from 'cs2parser';
import { performance } from 'node:perf_hooks';

const DEMO = 'D:/workfolder/Shin-Apps/resource/42k-Dust2.dem';

async function run(mode) {
  const parser = new DemoReader();
  const killMap = new Map();
  const roundWins = { 2: 0, 3: 0 };
  let roundEndCount = 0, deathCount = 0;

  parser.gameEvents.on('round_end', ev => {
    roundEndCount++;
    if (roundWins[ev.winner] !== undefined) roundWins[ev.winner]++;
  });

  parser.gameEvents.on('player_death', ev => {
    deathCount++;
    if (ev.attacker && ev.attacker !== ev.userid) {
      const a = killMap.get(ev.attacker) || { kills: 0, deaths: 0, assists: 0 };
      a.kills++; killMap.set(ev.attacker, a);
    }
    const v = killMap.get(ev.userid) || { kills: 0, deaths: 0, assists: 0 };
    v.deaths++; killMap.set(ev.userid, v);
    if (ev.assister) {
      const s = killMap.get(ev.assister) || { kills: 0, deaths: 0, assists: 0 };
      s.assists++; killMap.set(ev.assister, s);
    }
  });

  const t0 = performance.now();
  const outcome = await parser.parseDemo(DEMO, { entities: mode });
  const elapsed = performance.now() - t0;

  const nameMap = new Map();
  for (const p of parser.players) if (p?.name && p.userid !== undefined) nameMap.set(p.userid, p.name);

  console.log(`\n===== EntityMode.${mode} =====`);
  console.log(`status=${outcome.status}  耗时=${elapsed.toFixed(0)}ms  死亡事件=${deathCount}  回合事件=${roundEndCount}`);
  console.log(`round_end 累计比分 T:CT = ${roundWins[2]} : ${roundWins[3]}`);

  if (parser.teams.length) {
    for (const t of parser.teams) {
      console.log(`  [team${t.teamNumber}] ${t.clanName || t.teamName}  总分=${t.score}  上半场=${t.scoreFirstHalf}  下半场=${t.scoreSecondHalf}`);
    }
  } else {
    console.log('  (无 team 实体)');
  }

  if (mode === EntityMode.NONE) {
    console.log('玩家名单:', parser.players.filter(Boolean).map(p => p.name).join(', '));
    console.log('KDA(事件统计):');
    const rows = [...killMap].map(([uid, k]) => ({ name: nameMap.get(uid) ?? `uid_${uid}`, ...k }));
    rows.sort((a, b) => b.kills - a.kills);
    for (const r of rows) console.log(`  ${r.name}: ${r.kills}K ${r.deaths}D ${r.assists}A`);
  }

  if (mode === EntityMode.ONLY_GAME_RULES) {
    const gr = parser.gameRules;
    console.log(`gameRules: roundsPlayed=${gr?.roundsPlayed} phase=${gr?.phase} isWarmup=${gr?.isWarmup}`);
  }

  if (mode === EntityMode.ALL) {
    console.log('玩家(playerControllers 实体):');
    for (const p of parser.playerControllers) {
      console.log(`  ${p.name} [team${p.teamNumber}]: ${p.kills}K ${p.deaths}D ${p.assists}A ${p.mvps}MVP score=${p.score} money=${p.money} alive=${p.isAlive}`);
    }
  }
}

await run(EntityMode.NONE);
await run(EntityMode.ONLY_GAME_RULES);
await run(EntityMode.ALL);
