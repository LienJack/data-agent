/** Data-free reference for the model's Cell; the Host/Oracle never execute it. */
export const MONTHLY_COMPARISON_PREPARATION_REFERENCE = `import math
import pandas as pd

def prepare_monthly_comparison(input_frame, contract):
    time_key = contract['time_column']
    source_keys = contract['source_columns']
    fields = contract['measure_fields']
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

    def relative(change, base):
        return None if change is None or base is None or base == 0 else change / base

    result = {'observations': observations, 'claim_strength': 'DESCRIPTIVE'}
    for field in fields:
        column = field['source_column']
        points = [{'period': row[time_key], 'value': row[column]} for row in observations]
        observed = [point for point in points if point['value'] is not None]
        assert len(points) == 12 and len(observed) > 0, 'MONTHLY_POINTS_INVALID'
        lowest = sorted(observed, key=lambda point: (point['value'], point['period']))
        highest = sorted(observed, key=lambda point: (-point['value'], point['period']))
        first, last = points[0], points[-1]
        change = None if first['value'] is None or last['value'] is None else last['value'] - first['value']
        drops = []
        for index in range(1, len(points)):
            before, after = points[index - 1], points[index]
            if before['value'] is not None and after['value'] is not None and after['value'] < before['value']:
                delta = after['value'] - before['value']
                drops.append({'from_period': before['period'], 'to_period': after['period'], 'absolute_change': delta, 'relative_change': relative(delta, before['value'])})
        drops.sort(key=lambda drop: (drop['absolute_change'], drop['to_period']))
        result[field['field']] = {
            'source_column': column, 'observed_count': len(observed), 'missing_count': len(points) - len(observed),
            'minimum': lowest[0]['value'], 'maximum': highest[0]['value'], 'lowest': lowest[:3], 'highest': highest[:3],
            'first_period': first['period'], 'last_period': last['period'], 'first_value': first['value'], 'last_value': last['value'],
            'absolute_change': change, 'relative_change': relative(change, first['value']), 'largest_drops': drops[:3],
        }
    return result
`;
