"""Lossless fixed-page fallback for semantic content that outgrows a template.

The existing template is tried first. This path validates the complete input,
wraps against physical column widths and continues onto pages at readable sizes.
It never shortens a string to satisfy a template's editorial character budget.
"""
from __future__ import annotations

import math
import json
import unicodedata
from pathlib import Path
from .shared import SkillError, reject_unknown

METRIC_CONTRACT=json.loads((Path(__file__).resolve().parents[3]/'contracts'/'presentation-metrics.json').read_text(encoding='utf-8'))

FIELDS = {
    'cover': ('title', 'subtitle', 'meta'), 'section': ('title', 'number', 'subtitle'),
    'summary': ('title', 'bullets'), 'bullets': ('title', 'kicker', 'bullets', 'note'),
    'two-column': ('title', 'left', 'right'), 'metrics': ('title', 'metrics'),
    'timeline': ('title', 'events'), 'feature-grid': ('title', 'items'),
    'roadmap': ('title', 'stages'), 'quote': ('quote', 'attribution'),
    'closing': ('title', 'subtitle', 'contact'),
}
ADAPTABLE_ERRORS = {'text_too_long', 'too_many_bullets', 'bullets_too_long',
    'metric_value_unreadable', 'invalid_metrics', 'invalid_timeline',
    'invalid_features', 'invalid_feature', 'invalid_roadmap', 'template_overflow',
    'invalid_text', 'invalid_column'}


def text(value, label, required=False):
    if value is None and not required:
        return ''
    if not isinstance(value, str) or (required and not value.strip()):
        raise SkillError('invalid_text', f'{label} must be text' + (' and nonempty.' if required else '.'))
    if len(value) > 100000:
        raise SkillError('text_resource_limit', f'{label} exceeds the 100000-character input limit.')
    return value


def array(value, label):
    if value is None: return []
    if not isinstance(value, list) or len(value) > 1000:
        raise SkillError('invalid_items', f'{label} must contain at most 1000 entries.')
    return value


def bullets(value):
    result=[]
    for item in array(value, 'bullets'):
        if isinstance(item, str):
            result.append((text(item, 'bullet', True), False))
        elif isinstance(item, dict):
            reject_unknown(item, {'text','level','accent'}, label='bullet')
            level=item.get('level',0)
            if type(level) is not int or level not in (0,1) or type(item.get('accent',False)) is not bool:
                raise SkillError('invalid_bullet', 'Bullet level/accent has an invalid type.')
            result.append((text(item.get('text'),'bullet.text',True), item.get('accent',False)))
        else:
            raise SkillError('invalid_bullet', 'Each bullet must be text or an object.')
    return result


def semantic_columns(item):
    layout=item['layout']
    if layout == 'two-column' and 'note' in item:
        raise SkillError('unsupported_visible_note', 'two-column has no visible note field. Keep visible content in left.bullets or right.bullets; use speaker_notes only for narration notes. Content was not discarded.')
    reject_unknown(item, {'layout', *FIELDS[layout]}, label='adaptive slide')
    title=text(item.get('quote' if layout=='quote' else 'title'), 'title')
    if layout=='two-column':
        columns=[]
        for side in ('left','right'):
            column=item.get(side) or {}
            if not isinstance(column,dict):
                raise SkillError('invalid_column', f'{side} must be an object.')
            reject_unknown(column, {'heading','bullets'}, label=side)
            columns.append({'heading':text(column.get('heading'),'heading'),
                            'blocks':[[entry] for entry in bullets(column.get('bullets'))]})
        return title,columns
    blocks=[]
    for field in FIELDS[layout]:
        if field in ('title','quote'):
            continue
        if field=='bullets':
            blocks.extend([[entry] for entry in bullets(item.get(field))])
        elif field in ('metrics','events','items','stages'):
            keys={'metrics':('value','label','detail'),'events':('period','title','detail'),
                  'items':('title','detail'),'stages':('stage','title','detail')}[field]
            for entry in array(item.get(field),field):
                if not isinstance(entry,dict):
                    raise SkillError('invalid_item', f'{field} entry must be an object.')
                reject_unknown(entry,set(keys),label=field)
                block=[]
                for key in keys:
                    value=text(entry.get(key),key,key=='value')
                    if key=='value' and any(c in value for c in '\r\n\t\v\f\u0085\u2028\u2029'):
                        raise SkillError('invalid_metric', 'Metric values must be single-line text.')
                    if key=='value' and len(value)>METRIC_CONTRACT['maximumValueCharacters']:
                        raise SkillError('invalid_metric', 'Metric value exceeds the shared input contract; put explanation in detail.')
                    if value: block.append((value,key in ('value','label','title','period','stage')))
                if block: blocks.append(block)
        else:
            value=text(item.get(field),field)
            if value: blocks.append([(value,False)])
    # A long quotation is body content, not a tiny title textbox.
    if layout=='quote' and title:
        blocks.insert(0,[(title,False)])
        title='引语'
    return title,[{'heading':'','blocks':blocks}]


def wrap(value, width, size):
    capacity=width*72*.94/size
    lines=[]
    current=''
    units=0
    for char in value:
        if char=='\n':
            lines.append(current);current='';units=0;continue
        cost=1.15 if unicodedata.east_asian_width(char) in ('W','F','A') or char in 'MWmw%@' else .7
        if current and units+cost>capacity:
            lines.append(current);current='';units=0
        current+=char;units+=cost
    lines.append(current)
    return lines


def balanced_groups(groups,capacity,target_pages):
    """Minimum-page ordered partition, then balance occupied height per page."""
    needed=1;used=0
    for group in groups:
        cost=len(group)+(1 if used else 0)
        if used+cost>capacity: needed+=1;used=len(group)
        else: used+=cost
    count=max(needed,min(target_pages,len(groups)))
    if count>200: raise SkillError('page_resource_limit','Too many readable continuation pages.')
    # Text areas contain only a few lines, bounding the inner candidate scan.
    costs={0:0};history=[]
    for page in range(count):
        next_costs={};previous={}
        for end in range(page+1,len(groups)+1):
            height=0
            for start in range(end-1,page-1,-1):
                height+=len(groups[start])+(1 if start<end-1 else 0)
                if height>capacity: break
                if start not in costs: continue
                candidate=costs[start]+height*height
                if candidate<next_costs.get(end,float('inf')):
                    next_costs[end]=candidate;previous[end]=start
        costs=next_costs;history.append(previous)
    end=len(groups);pages=[]
    for previous in reversed(history):
        start=previous[end];pages.append(groups[start:end]);end=start
    return list(reversed(pages))


def paginate(column,width,capacity,target_pages=1):
    """Place whole semantic blocks; split only a block larger than a page."""
    heading=wrap(column['heading'],width,18) if column['heading'] else []
    blocks=column['blocks'][:]
    if len(heading)>3:
        blocks.insert(0,[(column['heading'],True)])
        heading=[]
    header=[(line,True,False,-1) for line in heading]
    if header: header.append(('',False,False,-1))
    pages=[]
    current=header[:]
    body_capacity=capacity-len(header)
    groups=[[(line,bold,False,number) for value,bold in parts for line in wrap(value,width,18)]
            for number,parts in enumerate(blocks)]
    if groups and all(len(group)<=body_capacity for group in groups):
        for number,partition in enumerate(balanced_groups(groups,body_capacity,target_pages)):
            page=[(line,bold,number>0,block) for line,bold,_repeat,block in header]
            for index,group in enumerate(partition):
                if index: page.append(('',False,False,-1))
                page.extend(group)
            pages.append(page)
        return pages
    def finish():
        nonlocal current
        pages.append(current)
        current=[(line,bold,True,block) for line,bold,_repeat,block in header]
    for number,parts in enumerate(blocks):
        lines=[(line,bold,False,number) for value,bold in parts for line in wrap(value,width,18)]
        gap=1 if len(current)>len(header) else 0
        if len(lines)<=body_capacity:
            if len(current)+gap+len(lines)>capacity:
                finish();gap=0
            if gap: current.append(('',False,False,-1))
            current.extend(lines)
        else:
            if len(current)>len(header): finish()
            # Reserve one continuation-context line and balance chunks so the
            # final page cannot contain only the last word of a long paragraph.
            parts_count=math.ceil(len(lines)/(body_capacity-1))
            chunk=math.ceil(len(lines)/parts_count)
            for start in range(0,len(lines),chunk):
                if start:
                    finish()
                    current.append((f'第 {number+1} 项（续）',True,True,number))
                current.extend(lines[start:start+chunk])
    if len(current)>len(header) or not pages: pages.append(current)
    return pages


def plan(item):
    title,columns=semantic_columns(item)
    if not title.strip() and not any(column['heading'].strip() or any(value.strip() for block in column['blocks'] for value,_ in block) for column in columns):
        raise SkillError('empty_slide', 'A slide needs visible content; optional labels and notes cannot replace it.')
    width=5.42 if len(columns)==2 else 11.38
    # 18pt body with explicit 25pt line boxes; keep the original title complete
    # in the flow if it needs more than the two-line header region.
    title_lines=wrap(title,11.38,30) if title else []
    if len(title_lines)>2:
        columns[0]['blocks'].insert(0,[(title,True)]);title_lines=['内容续页' if len(columns)==2 else '正文']
    title_height=max(.65,len(title_lines)*.55) if title_lines else 0
    start_y=1.12+title_height+(.28 if title_lines else 0)
    line_height=25/72
    lines_per_page=math.floor((6.62-start_y)/line_height)
    flows=[paginate(column,width,lines_per_page) for column in columns]
    count=max(map(len,flows))
    # Compare columns on the same set of pages where whole blocks permit it,
    # rather than exhaust the short column on page one and strand the other.
    if count>1: flows=[paginate(column,width,lines_per_page,count) for column in columns]
    if count>200:
        raise SkillError('page_resource_limit','One semantic slide requires more than 200 readable pages; divide the input.')
    return [{'layout':item['layout'],'title':'\n'.join(title_lines),'titleHeight':title_height,'y':start_y,'width':width,
             'columns':[flow[page] if page<len(flow) else [] for flow in flows]}
            for page in range(count)]


def draw(slide,page,add_text):
    if page['title']:
        add_text(slide,name=f"Presentation Title [{page['layout']}]",x=.96,y=1.05,width=11.38,
                 height=page['titleHeight'],text=page['title'],size=30,bold=True)
    for column,lines in enumerate(page['columns']):
        for row,(value,bold,repeated,block) in enumerate(lines):
            if value:
                marker='adaptive-context' if repeated else 'adaptive'
                add_text(slide,name=f"Presentation Text [{page['layout']}] {marker} {column}-{row} block={block}",
                         x=.96+column*5.96,y=page['y']+row*25/72,width=page['width'],
                         height=25/72,text=value,size=18,bold=bold)
