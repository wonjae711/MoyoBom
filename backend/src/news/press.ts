/**
 * 기사 원문 도메인 → 언론사명.
 * 네이버 뉴스 검색 API는 언론사명을 주지 않으므로 originallink의 도메인으로 판별한다 (F-01, F-11 출처 다양성).
 * 여기 없는 도메인은 도메인 그대로 저장되므로, 자주 보이는 도메인은 수집 로그를 보고 추가한다.
 */
const PRESS_BY_DOMAIN: Record<string, string> = {
  // 종합 일간지
  'chosun.com': '조선일보',
  'joongang.co.kr': '중앙일보',
  'donga.com': '동아일보',
  'hani.co.kr': '한겨레',
  'khan.co.kr': '경향신문',
  'hankookilbo.com': '한국일보',
  'seoul.co.kr': '서울신문',
  'kmib.co.kr': '국민일보',
  'segye.com': '세계일보',
  'munhwa.com': '문화일보',
  // 경제지
  'biz.chosun.com': '조선비즈',
  'mk.co.kr': '매일경제',
  'hankyung.com': '한국경제',
  'sedaily.com': '서울경제',
  'mt.co.kr': '머니투데이',
  'edaily.co.kr': '이데일리',
  'asiae.co.kr': '아시아경제',
  'fnnews.com': '파이낸셜뉴스',
  'heraldcorp.com': '헤럴드경제',
  'news.heraldcorp.com': '헤럴드경제',
  // 통신사
  'yna.co.kr': '연합뉴스',
  'newsis.com': '뉴시스',
  'news1.kr': '뉴스1',
  // 방송
  'kbs.co.kr': 'KBS',
  'imbc.com': 'MBC',
  'sbs.co.kr': 'SBS',
  'jtbc.co.kr': 'JTBC',
  'ytn.co.kr': 'YTN',
  'mbn.co.kr': 'MBN',
  'ichannela.com': '채널A',
  'tvchosun.com': 'TV조선',
  'yonhapnewstv.co.kr': '연합뉴스TV',
  // IT·전문지
  'zdnet.co.kr': '지디넷코리아',
  'etnews.com': '전자신문',
  'dt.co.kr': '디지털타임스',
  'bloter.net': '블로터',
  // 인터넷 언론
  'ohmynews.com': '오마이뉴스',
  'pressian.com': '프레시안',
  'nocutnews.co.kr': '노컷뉴스',
  'breaknews.com': '브레이크뉴스',
  'gukjenews.com': '국제뉴스',
  'ajunews.com': '아주경제',
  'enewstoday.co.kr': '이뉴스투데이',
  'thepowernews.co.kr': '더파워뉴스',
  'dailian.co.kr': '데일리안',
  'newsclaim.co.kr': '뉴스클레임',
  'digitaltoday.co.kr': '디지털투데이',
  'newsworks.co.kr': '뉴스웍스',
  'straightnews.co.kr': '스트레이트뉴스',
  'ekn.kr': '에너지경제',
  'etoday.co.kr': '이투데이',
  'fntoday.co.kr': '파이낸셜투데이',
  'newdaily.co.kr': '뉴데일리',
  'newspim.com': '뉴스핌',
  'sentv.co.kr': '서울경제TV',
  'viewsnnews.com': '뷰스앤뉴스',
  'wikitree.co.kr': '위키트리',
  // 지역 언론·지역 방송
  'gnmaeil.com': '경남매일',
  'idaegu.co.kr': '대구신문',
  'ulsanpress.net': '울산신문',
  'yeongnam.com': '영남일보',
  'kwangju.co.kr': '광주일보',
  'kyeongin.com': '경인일보',
  'andongmbc.co.kr': '안동MBC',
  'mpmbc.co.kr': '목포MBC',
  'usmbc.co.kr': '울산MBC',
  'g1tv.co.kr': 'G1방송',
  'tbc.co.kr': 'TBC',
  // 연예·스포츠
  'newsen.com': '뉴스엔',
  'topstarnews.net': '톱스타뉴스',
  'mhnse.com': 'MHN스포츠',
  'xportsnews.com': '엑스포츠뉴스',
  'osen.co.kr': 'OSEN',
  'stoo.com': '스포츠투데이',
  'tvreport.co.kr': 'TV리포트',
  'mydaily.co.kr': '마이데일리',
  // 원문 링크가 없을 때 쓰는 네이버 뉴스 링크
  'naver.com': '네이버뉴스',
};

/**
 * URL의 언론사명을 돌려준다. 하위 도메인은 가장 구체적인 항목부터 찾는다
 * (예: biz.chosun.com → 조선비즈, www.chosun.com → 조선일보). URL이 아니면 null.
 */
export function resolvePress(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const labels = hostname.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const press = PRESS_BY_DOMAIN[labels.slice(i).join('.')];
    if (press) return press;
  }
  return hostname.replace(/^www\./, '');
}
