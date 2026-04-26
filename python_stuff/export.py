# import pickle
# import m2cgen as m2c

# model_dict = pickle.load(open('model.p', 'rb'))
# model = model_dict['model']

# js_code = m2c.export_to_javascript(model)

# with open("model_logic.js", "w") as f:
#     f.write("export function predict(features) {\n")
#     f.write(js_code)
#     f.write("\n return score(features);\n}")
