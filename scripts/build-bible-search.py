#!/usr/bin/env python3
"""Build the offline search corpus from the bundled, unmodified JWPUB database.

Requires Python 3 and cryptography. Run from any directory:
  python scripts/build-bible-search.py [--db /path/to/publication.db]
No network access or manually authored topical associations are used.
"""
from __future__ import annotations
import argparse, gzip, hashlib, html, json, re, sqlite3, unicodedata, zlib
from pathlib import Path
from html.parser import HTMLParser
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 1
MASK = bytes.fromhex('11cbb5587e32846d4c26790c633da289f66fe5842a3a585ce1bc3a294af5ada7')

def clean(value):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]*>', ' ', value or ''))).strip()

def normalized(value):
    return ''.join(c for c in unicodedata.normalize('NFD', clean(value).lower()) if unicodedata.category(c) != 'Mn')

class Node:
    def __init__(self, tag='root', attrs=None): self.tag, self.attrs, self.children = tag, dict(attrs or []), []
    def text(self): return ''.join(n if isinstance(n, str) else n.text() for n in self.children)
    def walk(self):
        yield self
        for n in self.children:
            if isinstance(n, Node): yield from n.walk()

class Tree(HTMLParser):
    def __init__(self, value):
        super().__init__(convert_charrefs=True); self.root=Node(); self.stack=[self.root]; self.feed(value)
    def handle_starttag(self, tag, attrs):
        node=Node(tag,attrs); self.stack[-1].children.append(node)
        if tag not in {'br','hr','img','meta','link','input','source','wbr','area','col','embed','param'}: self.stack.append(node)
        if tag=='br': node.children.append(' ')
    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i].tag==tag: del self.stack[i:]; return
    def handle_data(self,data): self.stack[-1].children.append(data)

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--db',type=Path); parser.add_argument('--out',type=Path,default=ROOT/'biblia/search/builtin.json.gz'); args=parser.parse_args()
    bundled=ROOT/'biblia/bundled'; manifest=json.loads((bundled/'manifest.json').read_text())
    if args.db: dbbytes=args.db.read_bytes()
    else: dbbytes=gzip.decompress(b''.join((bundled/chunk['path']).read_bytes() for chunk in manifest['database']['chunks']))
    digest=hashlib.sha256(dbbytes).hexdigest()
    if not args.db and digest != manifest['database']['sha256']: raise SystemExit('Bundled database hash does not match its manifest.')
    db=sqlite3.connect(':memory:'); db.deserialize(dbbytes)
    tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    language,symbol,year,issue,title=db.execute('SELECT MepsLanguageIndex,Symbol,Year,IssueTagNumber,Title FROM Publication LIMIT 1').fetchone()
    card=f'{language}_{symbol}_{year}'+(f'_{int(issue)}' if issue and int(issue) else '')
    material=bytes(a^b for a,b in zip(hashlib.sha256(card.encode()).digest(),MASK)); cipher=Cipher(algorithms.AES(material[:16]),modes.CBC(material[16:]))
    def decode(blob):
        decryptor=cipher.decryptor(); value=decryptor.update(blob)+decryptor.finalize()
        return zlib.decompress(value[:-value[-1]]).decode('utf-8')
    books={n:clean(t) for n,t in db.execute('SELECT BibleBookId,COALESCE(ChapterDisplayTitle,BookDisplayTitle) FROM BibleBook')}
    if str(language)=='5':
        names=json.loads(re.search(r'const BOOK_NAMES = (\[[^;]+\]);',(ROOT/'biblia/search-core.js').read_text()).group(1))
        books.update({i+1:name for i,name in enumerate(names)})
    documents={row[0]:{'meps':row[1],'title':clean(row[2]),'class':str(row[3])} for row in db.execute('SELECT DocumentId,MepsDocumentId,Title,Class FROM Document')}
    meps={value['meps']:ident for ident,value in documents.items()}
    bookdocs={doc:book for book,doc in db.execute('SELECT BibleBookId,BookDocumentId FROM BibleBook')}
    records=[]; verse_targets={}; canonical=set()
    def passage(target):
        label=f"{books.get(target['book'],str(target['book']))} {target['chapter']}:{target['verse']}"
        if target.get('endVerse') and (target['endVerse']!=target['verse'] or target.get('endChapter')!=target['chapter']):
            label+='–'+(f"{books.get(target['endBook'],str(target['endBook']))} " if target.get('endBook',target['book'])!=target['book'] else '')+(f"{target['endChapter']}:" if target.get('endChapter',target['chapter'])!=target['chapter'] else '')+str(target['endVerse'])
        return label
    def target_href(href):
        match=re.match(r'^jwpub://b/[^/]+/(\d+):(\d+):(\d+)(?:-(\d+):(\d+):(\d+))?/?$',href)
        if match:
            nums=[int(x) if x else None for x in match.groups()]; t=dict(book=nums[0],chapter=nums[1],verse=max(1,nums[2]))
            if nums[3]:t.update(endBook=nums[3],endChapter=nums[4],endVerse=nums[5])
            return t
        match=re.match(r'^jwpub://c/[A-Za-z-]+:(\d+)/(\d+):(\d+)(?:-(\d+):(\d+))?/?$',href)
        if match:
            nums=[int(x) if x else None for x in match.groups()]; book=bookdocs.get(meps.get(nums[0]))
            if book:
                t=dict(book=book,chapter=nums[1],verse=max(1,nums[2]))
                if nums[3]:t.update(endBook=book,endChapter=nums[3],endVerse=nums[4])
                return t
        return None
    def links(tree):
        out=[];seen=set()
        for node in tree.walk():
            if node.tag!='a':continue
            t=target_href(node.attrs.get('href',''))
            if t:
                key=json.dumps(t,sort_keys=True)
                if key not in seen:out.append({'target':t,'label':passage(t)});seen.add(key)
        return out
    def add(ident,kind,title,text,target,source,refs=None):
        text=clean(text)
        if not text:return
        rec={'id':ident,'kind':kind,'title':clean(title),'text':text,'target':target,'source':source}
        if refs:rec['links']=refs
        records.append(rec)
    for ident,blob in db.execute('SELECT BibleVerseId,Content FROM BibleVerse ORDER BY BibleVerseId'):
        if not blob:continue
        source=decode(blob); match=re.search(r'\bid=["\']v(\d+)-(\d+)-(\d+)["\']',source)
        if not match:continue
        book,chapter,verse=map(int,match.groups());t=dict(book=book,chapter=chapter,verse=max(1,verse));verse_targets[ident]=t
        add(f'v:{ident}','verse',passage(t),source,t,'Texto bíblico')
    # Book outlines are the publication's own descriptions of narrative ranges.
    if 'BibleOutlineEntry' in tables:
        for ident,book,ch,v,endch,endv,blob in db.execute('SELECT BibleOutlineEntryId,Book,BeginChapterNumber,BeginVerseNumber,EndChapterNumber,EndVerseNumber,Content FROM BibleOutlineEntry ORDER BY BibleOutlineEntryId'):
            if not blob or not ch:continue
            source=decode(blob);tree=Tree(source).root; text=clean(tree.text());t=dict(book=book,chapter=ch,verse=max(1,v or 1))
            if endv:t.update(endBook=book,endChapter=endch or ch,endVerse=endv)
            if not re.search(r'[A-Za-zÀ-ÿ]',text):continue
            add(f'o:{ident}','outline',text,text,t,'Conteúdo de '+books.get(book,str(book)))
            canonical.add(normalized(text))
    study_parent={}
    if 'VerseCommentaryMap' in tables:
        for note,verse in db.execute('SELECT VerseCommentaryId,BibleVerseId FROM VerseCommentaryMap ORDER BY VerseCommentaryMapId'):
            if verse in verse_targets:study_parent.setdefault(note,verse_targets[verse])
    specs=[('VerseCommentary','VerseCommentaryId','Label','study','Nota de estudo'),('Footnote','FootnoteId','NULL','fn','Nota de rodapé'),('Extract','ExtractId','Caption','extract','Glossário e trechos de referência')]
    for table,key,label,prefix,source_label in specs:
        if table not in tables:continue
        footparents={r[0]:(verse_targets.get(r[1]),r[2]) for r in db.execute('SELECT FootnoteId,BibleVerseId,DocumentId FROM Footnote')} if table=='Footnote' else {}
        for ident,title_raw,blob in db.execute(f'SELECT {key},{label},Content FROM {table} ORDER BY {key}'):
            if not blob:continue
            source=decode(blob);tree=Tree(source).root;t={'noteId':f'{prefix}:{ident}'}
            parent=study_parent.get(ident) if table=='VerseCommentary' else footparents.get(ident,(None,None))[0] if table=='Footnote' else None
            if parent:t.update(parent)
            heading=next((clean(n.text()) for n in tree.walk() if re.fullmatch(r'h[1-6]',n.tag) and clean(n.text())),None)
            title=(source_label+' · '+passage(parent)) if parent else heading or clean(title_raw) or source_label
            if table=='Extract':title=re.sub(r'^\S+\s+', '',clean(title_raw)) if not heading and title_raw else title
            add(f'n:{prefix}:{ident}','note',title,source,t,source_label)
            groups=[{'text':clean(node.text()),'links':links(node)} for node in tree.walk() if node.tag=='p']
            records[-1]['linkGroups']=[group for group in groups if group['links']]
            if not records[-1]['linkGroups']:records[-1].pop('linkGroups')
            for n in tree.walk():
                if n.tag=='p' and clean(n.text()):canonical.add(normalized(n.text()))
    for ident,blob in db.execute('SELECT DocumentId,Content FROM Document WHERE Content IS NOT NULL ORDER BY DocumentId'):
        if not blob:continue
        meta=documents[ident];tree=Tree(decode(blob)).root;skip=set();number=0
        # Footnotes and navigation blocks are indexed through their own sources.
        def walk(node):
            nonlocal number
            classes=node.attrs.get('class','').split()
            if node.tag in {'script','style','nav'} or 'groupFootnote' in classes:return
            primary={'p','h1','h2','h3','h4','h5','h6'}
            standalone=node.tag in {'td','th','li','figcaption','dt','dd','caption'} and not any(child is not node and child.tag in primary for child in node.walk())
            if node.tag in primary or standalone:
                text=clean(node.text())
                if not text or normalized(text) in canonical:return
                number+=1;block=node.attrs.get('id');t={'documentId':ident}
                if block and re.fullmatch('p[0-9]+',block):t['paragraph']=int(block[1:])
                elif block:t['blockId']=block
                add(f'd:{ident}:{block or number}','document',meta['title'],text,t,'Texto de estudo · '+meta['title'],links(node));return
            for child in node.children:
                if isinstance(child,Node):walk(child)
        walk(tree)
    # Stable IDs are part of pagination; duplicate source IDs must not be emitted.
    unique={}
    for record in records: unique.setdefault(record['id'],record)
    records=list(unique.values());counts={kind:sum(r['kind']==kind for r in records) for kind in ['verse','note','document','outline']}
    payload={'schema':SCHEMA,'publication':digest[:24],'sourceSha256':digest,'title':clean(db.execute('SELECT Title FROM Publication LIMIT 1').fetchone()[0]),'counts':counts,'records':records}
    raw=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode();args.out.parent.mkdir(parents=True,exist_ok=True)
    with args.out.open('wb') as f:
        with gzip.GzipFile(filename='',mode='wb',fileobj=f,mtime=0,compresslevel=9) as z:z.write(raw)
    print(json.dumps({'publication':payload['publication'],'schema':SCHEMA,'counts':counts,'records':len(records),'jsonBytes':len(raw),'gzipBytes':args.out.stat().st_size,'asset':str(args.out)},ensure_ascii=False))

if __name__=='__main__':main()
