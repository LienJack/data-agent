import { PANEL_RATIO_PREPARATION_REFERENCE } from "./monthly-panel-ratio-reference.js";

/** Data-free reference for the model's Cell, not executed by the Host or used by the Oracle. */
export const MONTHLY_PANEL_PREPARATION_REFERENCE = `import math
import pandas as pd

${PANEL_RATIO_PREPARATION_REFERENCE}

def prepare_monthly_panel(input_frame, contract):
    time_key = contract['time_column']
    category_keys = contract['category_columns']
    fields = contract['measure_fields']
    source_keys = contract['source_columns']
    work = input_frame.loc[:, source_keys].copy(deep=True)
    if contract['time_logical_type'] == 'DATETIME':
        work[time_key] = pd.to_datetime(work[time_key], errors='raise', utc=True).dt.tz_convert(contract['timezone']).dt.strftime('%Y-%m-%d')
    else:
        work[time_key] = pd.to_datetime(work[time_key], errors='raise').dt.strftime('%Y-%m-%d')
    work = work.sort_values(time_key, kind='stable')
    observations = work.to_dict(orient='records')
    for row in observations:
        for field in fields:
            key = field['source_column']
            value = row[key]
            row[key] = None if pd.isna(value) else float(value)
            assert row[key] is None or math.isfinite(row[key]), 'SOURCE_NUMBER_INVALID'
    grouped = {}
    for row in observations:
        key = tuple(row[column] for column in category_keys)
        if key not in grouped:
            grouped[key] = []
        grouped[key].append(row)

    def relative(change, base):
        return None if change is None or base is None or base == 0 else change / base

    def describe(rows, column):
        points = [{'period': row[time_key], 'value': row[column]} for row in rows]
        observed = [point for point in points if point['value'] is not None]
        lowest = sorted(observed, key=lambda point: (point['value'], point['period']))
        highest = sorted(observed, key=lambda point: (-point['value'], point['period']))
        assert contract['month_count'] in (2, 12) and len(points) == contract['month_count'] and len(observed) > 0, 'MONTHLY_POINTS_INVALID'
        first, last = points[0], points[-1]
        change = None if first['value'] is None or last['value'] is None else last['value'] - first['value']
        drops = []
        for index in range(1, len(points)):
            before, after = points[index - 1], points[index]
            if before['value'] is not None and after['value'] is not None and after['value'] < before['value']:
                delta = after['value'] - before['value']
                drops.append({'from_period': before['period'], 'to_period': after['period'], 'absolute_change': delta, 'relative_change': relative(delta, before['value'])})
        drops.sort(key=lambda drop: (drop['absolute_change'], drop['to_period']))
        return {'source_column': column, 'observed_count': len(observed), 'missing_count': len(points) - len(observed),
                'minimum': lowest[0]['value'], 'maximum': highest[0]['value'], 'lowest': lowest[:3], 'highest': highest[:3],
                'first_period': first['period'], 'last_period': last['period'], 'first_value': first['value'], 'last_value': last['value'],
                'absolute_change': change, 'relative_change': relative(change, first['value']), 'largest_drops': drops[:3]}

    result = {'observations': observations, 'claim_strength': 'DESCRIPTIVE'}
    for field in fields:
        summaries = []
        for key, rows in grouped.items():
            summary = describe(rows, field['source_column'])
            summary['group'] = dict(zip(category_keys, key))
            summaries.append(summary)
        result[field['field']] = {'groups': summaries}
    pairs = []
    for index in range(len(grouped)):
        for up_field in fields:
            up = result[up_field['field']]['groups'][index]
            if up['absolute_change'] is None or up['absolute_change'] <= 0:
                continue
            for down_field in fields:
                down = result[down_field['field']]['groups'][index]
                if down['absolute_change'] is not None and down['absolute_change'] < 0:
                    pairs.append({'group': up['group'], 'increasing_column': up['source_column'], 'decreasing_column': down['source_column'],
                                  'from_period': up['first_period'], 'to_period': up['last_period'],
                                  'increasing_absolute_change': up['absolute_change'], 'decreasing_absolute_change': down['absolute_change'],
                                  'increasing_relative_change': up['relative_change'], 'decreasing_relative_change': down['relative_change']})
    result['opposed_changes'] = {'pairs': pairs}
    if 'ratio_rollup_mapping' in contract:
        result['ratio_rollup'] = prepare_ratio_rollup(observations, contract['ratio_rollup_mapping'])

    def total(rows, column):
        value = 0.0
        for row in rows:
            if row[column] is None:
                return None
            value += float(row[column])
        assert math.isfinite(value), 'MONTHLY_TOTAL_RANGE_INVALID'
        return value

    if 'period_comparison' in contract:
        mapping = contract['period_comparison']
        months = []
        for period in sorted(set(row[time_key] for row in observations)):
            selected = [row for row in observations if row[time_key] == period]
            current = total(selected, mapping['current_output'])
            prior = total(selected, mapping['comparison_output'])
            delta = None if current is None or prior is None else current - prior
            months.append({'period': period, 'current_value': current, 'comparison_value': prior, 'absolute_change': delta,
                           'yoy_rate': relative(delta, prior), 'ranking_eligible': current is not None and prior is not None and prior > 0})
        ranked = sorted([month for month in months if month['ranking_eligible'] and month['yoy_rate'] < 0], key=lambda month: (month['yoy_rate'], month['period']))[:3]
        declines = []
        for month in ranked:
            groups = []
            for row in observations:
                if row[time_key] != month['period']:
                    continue
                current, prior = row[mapping['current_output']], row[mapping['comparison_output']]
                delta = current - prior
                groups.append({'group': {mapping['category_output']: row[mapping['category_output']]},
                               'current_value': current, 'comparison_value': prior, 'absolute_change': delta,
                               'yoy_rate': row[mapping['rate_output']], 'contribution_to_total_growth': delta / month['comparison_value']})
            declines.append({**month, 'groups': groups})
        result['period_comparison'] = {'comparison_kind': 'YEAR_OVER_YEAR', 'group_coverage': 'BOTH_PERIOD_GROUPS',
                                       'ranking_basis': 'TOTAL_YOY_RATE', 'months': months, 'largest_declines': declines}
        result['overall_trend_rows'] = [{'period': month['period'], 'current_value': month['current_value'],
                                         'comparison_value': month['comparison_value'], 'yoy_rate': month['yoy_rate']} for month in months]
        result['largest_decline_group_rows'] = []
        for month in declines:
            for group in month['groups']:
                result['largest_decline_group_rows'].append({'period': month['period'],
                    'group_value': group['group'][mapping['category_output']],
                    'current_value': group['current_value'], 'comparison_value': group['comparison_value'],
                    'yoy_rate': group['yoy_rate'], 'contribution_to_total_growth': group['contribution_to_total_growth']})
    return result
`;
