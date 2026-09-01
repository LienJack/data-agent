/** Data-free reference for the model's Cell, not executed by the Host or used by the Oracle. */
export const CATEGORY_COMPARISON_PREPARATION_REFERENCE = `import math
import pandas as pd

def prepare_category_comparison(input_frame, contract):
    source_keys = contract['source_columns']
    category_keys = contract['dimension_columns']
    fields = contract['measure_fields']
    work = input_frame.loc[:, source_keys].copy(deep=True)
    observations = work.to_dict(orient='records')
    for row in observations:
        for key in category_keys:
            assert isinstance(row[key], str) and row[key], 'SOURCE_CATEGORY_INVALID'
        for field in fields:
            key = field['source_column']
            value = row[key]
            row[key] = None if pd.isna(value) else float(value)
            assert row[key] is None or math.isfinite(row[key]), 'SOURCE_NUMBER_INVALID'

    result = {'observations': observations, 'claim_strength': 'DESCRIPTIVE'}
    for field in fields:
        column = field['source_column']
        observed = []
        for index, row in enumerate(observations):
            value = row[column]
            if value is None:
                continue
            observed.append({'source_row_index': index,
                             'group': {key: row[key] for key in category_keys},
                             'value': value})
        assert observed, 'SOURCE_MEASURE_EMPTY'
        lowest = sorted(observed, key=lambda point: (point['value'], point['source_row_index']))
        highest = sorted(observed, key=lambda point: (-point['value'], point['source_row_index']))
        result[field['field']] = {
            'source_column': column,
            'observed_count': len(observed),
            'missing_count': len(observations) - len(observed),
            'minimum': lowest[0]['value'],
            'maximum': highest[0]['value'],
            'lowest': lowest[:3],
            'highest': highest[:3],
        }
    return result
`;
